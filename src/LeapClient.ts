import { ConnectionOptions, TLSSocket, connect, createSecureContext } from 'tls';
import debug from 'debug';
import * as fs from 'fs';
import { EventEmitter } from 'events';

import { CommuniqueType, Response, ResponseWithTag } from './Messages';
import {
    BodyType,
    Href,
    OnePingResponse,
    PingResponseDefinition,
    ClientSettingDefinition,
    OneClientSettingDefinition,
    ExceptionDetail,
} from './MessageBodyTypes';
import { ResponseParser } from './ResponseParser';

import TypedEmitter from 'typed-emitter';
import { v4 as uuidv4 } from 'uuid';

const logDebug = debug('leap:protocol:client');

export interface Message {
    CommuniqueType: CommuniqueType;
    Header: {
        ClientTag: string;
        Url: string;
    };
    Body?: Record<string, unknown>;
}

interface MessageDetails {
    message: Message;
    resolve: (message: Response) => void;
    reject: (err: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
}

type LeapClientEvents = {
    unsolicited: (response: Response) => void;
    disconnected: () => void;
};

export class LeapClient extends (EventEmitter as new () => TypedEmitter<LeapClientEvents>) {
    private connected: Promise<void> | null;

    private socket?: TLSSocket;
    private readonly tlsOptions: ConnectionOptions;

    private inFlightRequests: Map<string, MessageDetails> = new Map();
    private taggedSubscriptions: Map<string, (r: Response) => void> = new Map();

    private responseParser: ResponseParser;

    private sslKeylogFile?: fs.WriteStream;

    constructor(
        private readonly host: string,
        private readonly port: number,
        ca: string,
        key: string,
        cert: string,
        sslKeylogFile?: fs.WriteStream,
    ) {
        super();
        logDebug('new LeapClient being constructed');
        this.connected = null;
        const context = createSecureContext({
            ca,
            key,
            cert,
        });

        this.tlsOptions = {
            secureContext: context,
            secureProtocol: 'TLSv1_2_method',
            rejectUnauthorized: false,
        };

        this.responseParser = new ResponseParser();
        this.responseParser.on('response', this._handleResponse.bind(this));

        if (sslKeylogFile !== undefined) {
            this.sslKeylogFile = sslKeylogFile;
        }
    }

    public async retrieve<T extends BodyType>(href: Href, endpoint?: string): Promise<T> {
        const resp = await this.request('ReadRequest', href.href + (endpoint !== undefined ? endpoint : ''));
        if (resp.Body === undefined) {
            throw new Error(`could not get ${href.href}: no body`);
        }
        if (resp.Body instanceof ExceptionDetail) {
            throw new Error(`could not get ${href.href}: ${resp.Body.Message}`);
        }
        return resp.Body as T;
    }

    public async request(
        communiqueType: CommuniqueType,
        url: string,
        body?: Record<string, unknown>,
        tag?: string,
    ): Promise<Response> {
        logDebug(`request ${communiqueType} for url ${url}`);

        await this.connect();

        if (tag === undefined) {
            tag = uuidv4();
        }
        if (this.inFlightRequests.has(tag)) {
            const ifr = this.inFlightRequests.get(tag)!;
            ifr.reject(new Error('Request clobbered due to tag re-use'));
            clearTimeout(ifr.timeout);
            this.inFlightRequests.delete(tag);
        }

        let requestResolve: (response: Response) => void = () => {
            // this gets replaced
        };

        let requestReject: (err: Error) => void = () => {
            // this gets replaced
        };

        const requestPromise = new Promise<Response>((resolve, reject) => {
            requestResolve = resolve;
            requestReject = reject;
        });

        const message: Message = {
            CommuniqueType: communiqueType,
            Header: {
                ClientTag: tag,
                Url: url,
            },
        };

        if (body !== undefined) {
            message.Body = body;
        }

        const msg = JSON.stringify(message);
        logDebug('request handler about to write:', msg);

        let timeout;
        this.socket?.write(msg + '\n', () => {
            timeout = setTimeout(() => {
                requestReject(new Error('request with tag' + tag + 'timed out'));
            }, 5000);
            logDebug('sent request tag', tag, ' successfully');

            this.inFlightRequests.set(tag!, {
                message,
                resolve: requestResolve,
                reject: requestReject,
                timeout,
            });
            logDebug('added promise to inFlightRequests with tag key', tag);
        });
        return requestPromise;
    }

    public connect(): Promise<void> {
        if (!this.connected) {
            logDebug('needs to connect');
            this.connected = new Promise((resolve, reject) => {
                this.socket = connect(this.port, this.host, this.tlsOptions, () => {
                    logDebug('connected!');
                });

                this.socket.once('secureConnect', () => {
                    logDebug('securely connected');
                    this._onConnect(resolve, reject);
                });

                this.socket.once('error', (e) => {
                    logDebug('connection failed: ', e);
                    this.connected = null;
                    reject(e);
                });

                if (this.sslKeylogFile !== undefined) {
                    this.socket.on('keylog', (line) => this.sslKeylogFile!.write(line));
                }
            });
        }

        return this.connected;
    }

    public close() {
        // this method does not prevent the client from being used; instead it
        // only closes the connection. subsequent requests will trigger this
        // client to attempt to reconnect. make sure nobody is going to try to
        // use this client before you dispose of it.

        this.connected = null;
        this.socket?.end();
    }

    public async subscribe(
        url: string,
        callback: (resp: Response) => void,
        communiqueType?: CommuniqueType | undefined,
        body?: Record<string, unknown>,
        tag?: string,
    ): Promise<ResponseWithTag> {
        const _tag = tag || uuidv4();

        if (communiqueType === undefined) {
            communiqueType = 'SubscribeRequest';
        }

        return await this.request(communiqueType, url, body, _tag).then((response: Response) => {
            if (response.Header.StatusCode !== undefined && response.Header.StatusCode.isSuccessful()) {
                this.taggedSubscriptions.set(_tag, callback);
                logDebug('Subscribed to', url, ' as ', _tag);
            }

            return { response, tag: _tag };
        });
    }

    public drain() {
        this.removeAllListeners('unsolicited');
        this.removeAllListeners('disconnected');
        // Cancel all pending timeouts if any
        for (const tag of this.inFlightRequests.keys()) {
            const request = this.inFlightRequests.get(tag)!;
            clearTimeout(request.timeout);
        }
        this._empty();
        this.close();
    }

    private _empty() {
        this.inFlightRequests.clear();
        this.taggedSubscriptions.clear();
    }

    private _onConnect(next: () => void, _reject: (reason: any) => void): void {
        logDebug('_onConnect called');

        const socketErr = (err: Error) => {
            logDebug('socket error:', err);
        };

        const socketEnd = () => {
            logDebug('client socket has ended');
            this.socket?.end(); // Acknowledge to other end of the connection that the connection is ended.
            this.socket?.destroy(); // Prevent writes
        };

        const socketClose = (sock: TLSSocket): void => {
            logDebug('client socket has closed.');

            this.connected = null;
            this._empty();
            this.emit('disconnected');
        };

        this.socket?.on('error', socketErr);
        this.socket?.on('close', socketClose);
        this.socket?.on('data', this.socketDataHandler.bind(this));
        this.socket?.on('end', socketEnd);

        return next();
    }

    private socketDataHandler(data: Buffer): void {
        const s = data.toString();
        logDebug('got data from socket:', s);
        this.responseParser.handleData(s);
    }

    private _handleResponse(response: Response): void {
        const tag = response.Header.ClientTag;
        if (tag !== undefined) {
            logDebug('got response to tag', tag);
            const arrow: MessageDetails = this.inFlightRequests.get(tag)!;
            if (arrow !== undefined) {
                logDebug('tag', tag, ' recognized as in-flight');
                clearTimeout(arrow.timeout);
                this.inFlightRequests.delete(tag);
                arrow.resolve(response);
            } else {
                logDebug('tag', tag, ' not in flight');
                const sub = this.taggedSubscriptions.get(tag);
                if (sub !== undefined) {
                    logDebug('tag', tag, ' has a subscription');
                    sub(response);
                } else {
                    logDebug('ERROR was not expecting tag ', tag);
                }
            }
        } else {
            logDebug('got untagged, unsolicited response');
            this.emit('unsolicited', response);
        }
    }

    public async setVersion(): Promise<ExceptionDetail | ClientSettingDefinition> {
        logDebug('setVersion request');
        const resp = await this.request('UpdateRequest', '/clientsetting', {
            ClientSetting: {
                ClientMajorVersion: 1,
            },
        });

        switch (resp.CommuniqueType) {
            case 'ExceptionResponse': {
                return resp.Body! as ExceptionDetail;
            }
            case 'UpdateResponse': {
                return (resp.Body! as OneClientSettingDefinition).ClientSetting;
            }
            default: {
                throw new Error('bad communique type');
            }
        }
    }

    public async ping(): Promise<PingResponseDefinition> {
        const resp = await this.request('ReadRequest', '/server/1/status/ping');
        return (resp.Body! as OnePingResponse).PingResponse;
    }
}

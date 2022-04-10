import { ConnectionOptions, TLSSocket, connect, createSecureContext } from 'tls';
import debug from 'debug';
import { EventEmitter } from 'events';

import { Response, ResponseWithTag } from './Messages';
import { ResponseParser } from './ResponseParser';

import TypedEmitter from 'typed-emitter';
import { v4 as uuidv4 } from 'uuid';

const logDebug = debug('leap:protocol:client');

interface Message {
    CommuniqueType: string;
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

interface LeapClientEvents {
    unsolicited: (response: Response) => void;
    disconnected: () => void;
}

export class LeapClient extends (EventEmitter as new () => TypedEmitter<LeapClientEvents>) {
    private connected: Promise<void> | null;

    private socket?: TLSSocket;
    private readonly tlsOptions: ConnectionOptions;

    private inFlightRequests: Map<string, MessageDetails> = new Map();
    private taggedSubscriptions: Map<string, (r: Response) => void> = new Map();

    private responseParser: ResponseParser;

    constructor(private readonly host: string, private readonly port: number, ca: string, key: string, cert: string) {
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
    }

    public async request(
        communiqueType: string,
        url: string,
        body?: Record<string, unknown>,
        tag?: string,
    ): Promise<Response> {
        await this.connect();

        if (tag === undefined) {
            tag = uuidv4();
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

        const timeout = setTimeout(() => {
            this.inFlightRequests.delete(tag!);
            requestReject(new Error('request with tag' + tag + 'timed out'));
        }, 5000);

        this.inFlightRequests.set(tag, {
            message,
            resolve: requestResolve,
            reject: requestReject,
            timeout,
        });
        logDebug('added promise to inFlightRequests with tag key', tag);

        const msg = JSON.stringify(message);
        logDebug('request handler about to write:', msg);
        this.socket?.write(msg + '\n', () => {
            logDebug('sent request tag', tag, ' successfully');
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
                    this._onConnect(resolve);
                });

                this.socket.once('error', (e) => {
                    console.error('connection failed: ', e);
                    this.connected = null;
                    reject(e);
                });
            });
        }

        return this.connected;
    }

    public close() {
        this.connected = null;
        this.socket?.end();
    }

    public async subscribe(
        url: string,
        callback: (resp: Response) => void,
        communiqueType?: string,
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

    private _empty() {
        this.inFlightRequests.clear();
        this.taggedSubscriptions.clear();
    }

    private _onConnect(next: () => void): void {
        logDebug('_onConnect called');

        const socketErr = (err: Error) => {
            console.error('socket error:', err);
        };

        const socketEnd = () => {
            logDebug('client socket has ended');
            this.socket?.end(); // Acknowledge to other end of the connection that the connection is ended.
            this.socket?.destroy(); // Prevent writes
        };

        const socketClose = (sock: TLSSocket): void => {
            console.warn('client socket has closed.');

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

    private socketDataHandler (data: Buffer): void {
        const s = data.toString();
        logDebug('got data from socket:', s);
        this.responseParser.handleData(s);
    };

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
}

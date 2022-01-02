import { ConnectionOptions, TLSSocket, connect, createSecureContext } from 'tls';
import debug from 'debug';
import { EventEmitter } from 'events';

import { Response } from './Messages';
import { ResponseParser } from './ResponseParser';

import TypedEmitter from 'typed-emitter';
import { v4 as uuidv4 } from 'uuid';

const logDebug = debug('leap:protocol');

export type ResponseWithTag = { response: Response; tag: string };

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
        }, 3000);

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
                logDebug('about to connect');
                this.socket = connect(this.port, this.host, this.tlsOptions, () => {
                    logDebug('connected!');
                });
                this.socket.once('secureConnect', () => {
                    logDebug('securely connected');
                    this._onConnect(resolve);
                });

                this.socket.once('error', (e) => {
                    logDebug('connection failed: ', e);
                    this.connected = null;
                    reject(e);
                });
            });
        }

        return this.connected;
    }

    public close() {
        this.connected = null;
        if (this.socket !== undefined) {
            this.socket.destroy();
        }
    }

    public async subscribe(
        url: string,
        callback: (resp: Response) => void,
        communiqueType: string,
        body?: Record<string, unknown>,
        tag?: string,
    ): Promise<ResponseWithTag> {
        const _tag = tag || uuidv4();

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
        // Clear out event listeners from _connect()
        if (this.socket) {
            this.socket.removeAllListeners('error');
            this.socket.removeAllListeners('connect');
            this.socket.removeAllListeners('secureConnect');
        }

        const socketError = (err: Error): void => {
            logDebug('socket error:', err);
            this._empty();

            if (this.socket) {
                this.socket.destroy();
            }

            this.removeAllListeners('unsolicited');
        };

        function socketEnd(this: TLSSocket): void {
            logDebug('client socket has ended');
            if (this) {
                // Acknowledge to other end of the connection that the connection is ended.
                this.end();
            }
        }

        function socketTimeout(this: TLSSocket): void {
            logDebug('client socket has timed out');
            if (this) {
                // Acknowledge to other end of the connection that the connection is ended.
                this.end();
            }
        }

        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const clientInstance = this;

        function socketClose(this: TLSSocket): void {
            logDebug('client socket has closed.');
            if (this) {
                this.removeListener('error', socketError);
                this.removeListener('close', socketClose);
                this.removeListener('data', clientInstance.socketDataHandler);
                this.removeListener('end', socketEnd);
                this.removeListener('timeout', socketTimeout);
            }

            if (this === clientInstance.socket) {
                clientInstance.connected = null;
                delete clientInstance.socket;
            }

            clientInstance._empty();
            clientInstance.removeAllListeners('unsolicited');
            this.emit('disconnected');
        }

        if (this.socket) {
            this.socket.on('error', socketError);
            this.socket.on('close', socketClose);
            this.socket.on('data', this.socketDataHandler);
            this.socket.on('end', socketEnd);
            this.socket.on('timeout', socketTimeout);
        }

        return next();
    }

    private readonly socketDataHandler = (data: Buffer): void => {
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

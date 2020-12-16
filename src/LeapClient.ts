import { ConnectionOptions, TLSSocket, connect, createSecureContext } from 'tls';
import debug from 'debug';
import { EventEmitter } from 'events';

import { Response } from './Messages';
import { ResponseParser } from './ResponseParser';

import TypedEmitter from 'typed-emitter';
import { v4 as uuidv4 } from 'uuid';

const log_debug = debug('leap:protocol');

export type ResponseWithTag = {response: Response, tag: string};

interface Message {
    CommuniqueType: string;
    Header: {
        ClientTag: string;
        Url: string;
    };
    body?: Record<string, unknown>;
}

interface MessageDetails {
    message: Message;
    resolve: (message?: Response) => void;
    reject: (err: Error) => void;
}

interface LeapClientEvents {
    unsolicited: (response: Response) => void;
}

export class LeapClient extends (EventEmitter as new () => TypedEmitter<LeapClientEvents>) {
    private connected = false;

    private socket?: TLSSocket;
    private readonly tlsOptions: ConnectionOptions;

    private inFlightRequests: Map<string, MessageDetails> = new Map();
    private taggedSubscriptions: Map<string, (r: Response) => void> = new Map();

    private responseParser: ResponseParser;

    constructor(private readonly host: string, private readonly port: number, ca: string, key: string, cert: string) {
        super();
        log_debug('new LeapClient being constructed');
        const context = createSecureContext({
            ca: ca,
            key: key,
            cert: cert,
        });

        this.tlsOptions = {
            secureContext: context,
        };

        this.responseParser = new ResponseParser();
        this.responseParser.on('response', this._handleResponse.bind(this));
    }

    public async request(
        communique_type: string,
        url: string,
        body?: Record<string, unknown>,
        tag?: string,
    ): Promise<Response> {
        log_debug('new request incoming with tag ', tag);
        if (!this.connected) {
            log_debug('was not connected');
            await this.connect();
        }
        log_debug('connected! continuing...');

        if (tag === undefined) {
            tag = uuidv4();
        }

        let requestResolve: (response?: Response) => void = () => {
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
            CommuniqueType: communique_type,
            Header: {
                ClientTag: tag,
                Url: url,
            },
        };

        if (body !== undefined) {
            message.body = body;
        }

        this.inFlightRequests[tag] = {
            message: message,
            resolve: requestResolve,
            reject: requestReject,
        };
        log_debug('added promise to inFlightRequests with tag key ', tag);

        const msg = JSON.stringify(message);
        log_debug('request handler about to write: ', msg);
        this.socket.write(msg, () => {
            log_debug('sent request tag ', tag, ' successfully');
        });

        return requestPromise;
    }

    public connect(): Promise<void> {
        if (this.connected) {
            log_debug('oops already connected');
            return Promise.resolve();
        }
        log_debug('needs to connect');

        return new Promise((resolve, reject) => {
            log_debug('about to connect');
            this.socket = connect(this.port, this.host, this.tlsOptions);
            this.socket.once('secureConnect', () => {
                log_debug('securely connected');
                this._onConnect(resolve);
            });

            this.socket.once('error', reject);
        });
    }

    public async subscribe(
        url: string,
        callback: (resp: Response) => void,
        communique_type: string,
        body?: Record<string, unknown>,
        tag?: string,
    ): Promise<ResponseWithTag> {
        if (tag === undefined) {
            tag = uuidv4();
        }

        return await this.request(communique_type, url, body, tag).then((response: Response) => {
            if (response.Header.StatusCode !== undefined && response.Header.StatusCode.isSuccessful()) {
                this.taggedSubscriptions[tag] = callback;
                log_debug('Subscribed to ', url, ' as ', tag);
            }

            return { response: response, tag: tag };
        });
    }

    private _empty() {
        for (const arrow in this.inFlightRequests) {
            delete this.inFlightRequests[arrow];
        }

        for (const sub in this.taggedSubscriptions) {
            delete this.inFlightRequests[sub];
        }
    }

    private _onConnect(next: () => void): void {
        log_debug('_onConnect called');
        // Clear out event listeners from _connect()
        if (this.socket) {
            this.socket.removeAllListeners('error');
            this.socket.removeAllListeners('connect');
            this.socket.removeAllListeners('secureConnect');
        }

        this.connected = true;

        const socketError = (err: Error): void => {
            log_debug('socket error: ', err);
            this._empty();

            if (this.socket) {
                this.socket.destroy();
            }

            this.removeAllListeners('unsolicited');
        };

        function socketEnd(this: TLSSocket): void {
            if (this) {
                // Acknowledge to other end of the connection that the connection is ended.
                this.end();
            }
        }

        function socketTimeout(this: TLSSocket): void {
            if (this) {
                // Acknowledge to other end of the connection that the connection is ended.
                this.end();
            }
        }

        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const clientInstance = this;

        function socketClose(this: TLSSocket): void {
            if (this) {
                this.removeListener('error', socketError);
                this.removeListener('close', socketClose);
                this.removeListener('data', clientInstance.socketDataHandler);
                this.removeListener('end', socketEnd);
                this.removeListener('timeout', socketTimeout);
            }

            if (this === clientInstance.socket) {
                clientInstance.connected = false;
                delete clientInstance.socket;
            }

            clientInstance._empty();
            clientInstance.removeAllListeners('unsolicited');
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
        log_debug('got data from socket: ', s);
        this.responseParser.handleData(s);
    };

    private _handleResponse(response: Response): void {
        const tag = response.Header.ClientTag;
        if (tag !== undefined) {
            log_debug('got response to tag ', tag);
            const arrow: MessageDetails = this.inFlightRequests[tag];
            if (arrow !== undefined) {
                log_debug('tag ', tag, ' recognized as in-flight');
                delete this.inFlightRequests[tag];
                arrow.resolve(response);
            } else {
                log_debug('tag ', tag, ' not in flight');
                const sub = this.taggedSubscriptions[tag];
                if (sub !== undefined) {
                    log_debug('tag ', tag, ' has a subscription');
                    sub(response);
                } else {
                    log_debug('ERROR was not expecting tag ', tag);
                }
            }
        } else {
            log_debug('got untagged, unsolicited response');
            this.emit('unsolicited', response);
        }
    }
}

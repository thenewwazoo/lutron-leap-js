import * as tls from 'tls';
import debug from 'debug';

import { Response } from './Messages';
import { ResponseParser } from './ResponseParser';

import { v4 as uuidv4 } from 'uuid';

const log_debug = debug('leapprotocol');

interface Message {
    CommuniqueType: string;
    Header: {
        ClientTag: string;
        Url: string;
    };
    body?: any;
}

interface MessageDetails {
    message: Message;
    resolve: (message?: Response) => void;
    reject: (err: Error) => void;
}

export class LeapClient {
    private connected = false;

    private socket?: tls.TLSSocket;
    private readonly tlsOptions: tls.ConnectionOptions;

    private inFlightRequests: Map<string, MessageDetails>;
    private taggedSubscriptions: Map<string, (r: Response) => void>;
    private unsolicitedSubs: Array<(r: Response) => void>;

    private responseParser: ResponseParser;

    constructor(private readonly host: string, private readonly port: number, ca: string, key: string, cert: string) {
        const context = tls.createSecureContext({
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

    public async request(communique_type: string, url: string, body?: any, tag?: string): Promise<Response> {
        if (!this.connected) {
            await this._connect();
        }

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

        this.socket.write(JSON.stringify(message), () => {
            log_debug('sent request tag ', tag, ' successfully');
        });

        return requestPromise;
    }

    private _connect(): Promise<void> {
        if (this.connected) {
            return Promise.resolve();
        }

        return new Promise((resolve, reject) => {
            this.socket = tls.connect(this.port, this.host, this.tlsOptions);
            this.socket.once('secureConnect', () => {
                this._onConnect(resolve);
            });

            this.socket.once('error', reject);
        });
    }

    private _empty() {
        for (const arrow in this.inFlightRequests) {
            this.inFlightRequests.delete(arrow);
        }

        for (const sub in this.taggedSubscriptions) {
            this.taggedSubscriptions.delete(sub);
        }

        this.unsolicitedSubs = [];
    }

    private _onConnect(next: () => void): void {
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
        };

        function socketEnd(this: tls.TLSSocket): void {
            if (this) {
                // Acknowledge to other end of the connection that the connection is ended.
                this.end();
            }
        }

        function socketTimeout(this: tls.TLSSocket): void {
            if (this) {
                // Acknowledge to other end of the connection that the connection is ended.
                this.end();
            }
        }

        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const clientInstance = this;

        function socketClose(this: tls.TLSSocket): void {
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
        this.responseParser.handleData(data.toString());
    };

    private _handleResponse(response: Response): void {
        const tag = response.Header.ClientTag;
        if (tag !== undefined) {
            log_debug('got response to tag ', tag);
            const arrow: MessageDetails = this.inFlightRequests[tag];
            if (arrow !== undefined) {
                log_debug('tag ', tag, ' recognized as in-flight');
                this.inFlightRequests.delete(tag);
                arrow.resolve(response);
            } else {
                const sub = this.taggedSubscriptions[tag];
                if (sub !== undefined) {
                    sub(response);
                } else {
                    log_debug('ERROR was not expecting tag ', tag);
                }
            }
        } else {
            log_debug('got untagged response');
            // maybe emit 'unsolicited'?
            for (const h of this.unsolicitedSubs) {
                try {
                    h(response);
                } catch (e) {
                    log_debug('got error from handler: ', e);
                }
            }
        }
    }
}

import debug from 'debug';

import { LeapClient } from './LeapClient';
import { Response } from './Messages';
import { Device } from './MessageBodyTypes';

const logDebug = debug('leap:bridge');
export const LEAP_PORT = 8081;
const PING_INTERVAL_MS = 60000;
const PING_TIMEOUT_MS = 1000;

export class SmartBridge {
    private pingLooper!: ReturnType<typeof setTimeout>; // this is indeed definitely set in the constructor

    // TODO need a way to do a reverse mDNS lookup so `id` here can come from the hostname

    constructor(private readonly bridgeID: string, private client: LeapClient) {
        logDebug("new bridge", bridgeID, "being constructed");
        client.on('unsolicited', this._handleUnsolicited);
        client.on('disconnected', this._handleDisconnect);

        this._setPingTimeout();
    }

    private _setPingTimeout(): void {
        this.pingLooper = setTimeout((): void => {
            clearTimeout(this.pingLooper);
            this.pingLoop();
        }, PING_INTERVAL_MS);
    }

    private pingLoop(): void {
        const timeout = new Promise((resolve, reject): void => {
            setTimeout((): void => {
                reject('Ping timeout');
            }, PING_TIMEOUT_MS);
        });

        Promise.race([this.ping(), timeout]).then(() => {
            clearTimeout(this.pingLooper);
            this._setPingTimeout();
        }).catch(e => {
            logDebug(e);
            this.client.close();
        });
    }

    public async ping(): Promise<Response> {
        return await this.client.request('ReadRequest', '/server/1/status/ping');
    }

    public async getDeviceInfo(): Promise<Device[]> {
        logDebug('getting all device info');
        return new Promise((resolve, reject) => {
            const raw = this.client.request('ReadRequest', '/device').then((response: Response) => {
                logDebug('0-0-0-0-0-0- WEE OO WEE OO -=-=-=-=-');
                logDebug(response);
                // @ts-ignore
                return response.Body!.Devices;
            });
            resolve(raw);
            /*
            if (raw.Header.StatusCode?.isSuccessful()) {
                this.raw = raw.Body['Devices'];
                resolve();
            } else {
                reject("failed to get device info");
            }
           */
        });
    }

    private _handleUnsolicited(response: Response) {
        logDebug('bridge ', this.bridgeID, 'got unsolicited message:');
        logDebug(response);
    }

    private _handleDisconnect(): void {
        // do things, probably
    }
}

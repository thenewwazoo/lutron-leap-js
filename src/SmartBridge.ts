import debug from 'debug';

import { LeapClient } from './LeapClient';
import { Response } from './Messages';
import { OneDeviceDefinition, Device } from './MessageBodyTypes';

const logDebug = debug('leap:bridge');
export const LEAP_PORT = 8081;
const PING_INTERVAL_MS = 60000;
const PING_TIMEOUT_MS = 1000;

export interface BridgeInfo {
    firmwareRevision: string;
    manufacturer: string;
    model: string;
    name: string;
    serialNumber: string;
}

export class SmartBridge {
    private pingLooper!: ReturnType<typeof setTimeout>; // this is indeed definitely set in the constructor

    constructor(
        public readonly bridgeID: string,
        private client: LeapClient
    ) {
        logDebug("new bridge", bridgeID, "being constructed");
        client.on('unsolicited', this._handleUnsolicited.bind(this));
        client.on('disconnected', this._handleDisconnect.bind(this));

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

    public async getBridgeInfo(): Promise<BridgeInfo> {
        logDebug('getting bridge information');
        const raw = await this.client.request('ReadRequest', '/device/1');
        if ((raw.Body! as OneDeviceDefinition).Device) {
            const device = (raw.Body! as OneDeviceDefinition).Device;
            return {
                firmwareRevision: device.FirmwareImage.Firmware.DisplayName,
                manufacturer: "Lutron Electronics Co., Inc",
                model: device.ModelNumber,
                name: device.FullyQualifiedName.join(' '),
                serialNumber: device.SerialNumber,
            };

        }
        throw new Error("Got bad response to bridge info request")
    }

    public async getDeviceInfo(): Promise<Device[]> {
        logDebug('getting info about all devices');
        return new Promise((resolve, reject) => {
            const raw = this.client.request('ReadRequest', '/device').then((response: Response) => {
                logDebug('all device info follows:');
                logDebug(response);
                // @ts-ignore
                return response.Body!.Devices;
            });
            resolve(raw);
        });
    }

    private _handleUnsolicited(response: Response) {
        logDebug('bridge', this.bridgeID, 'got unsolicited message:');
        logDebug(response);
    }

    private _handleDisconnect(): void {
        // do things, probably
    }
}

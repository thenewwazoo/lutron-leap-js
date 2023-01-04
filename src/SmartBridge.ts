import debug from 'debug';
import { EventEmitter } from 'events';

import { LeapClient } from './LeapClient';
import { Response, ResponseWithTag } from './Messages';
import {
    BodyType,
    ButtonDefinition,
    ButtonGroupDefinition,
    DeviceDefinition,
    ExceptionDetail,
    Href,
    MultipleDeviceDefinition,
    OneButtonDefinition,
    OneButtonGroupDefinition,
    OneDeviceDefinition,
    OneZoneStatus,
    MultipleOccupancyGroupStatus,
} from './MessageBodyTypes';

import TypedEmitter from 'typed-emitter';
const logDebug = debug('leap:bridge');

export const LEAP_PORT = 8081;
const PING_INTERVAL_MS = 300000;
const PING_TIMEOUT_MS = 10000;

export interface BridgeInfo {
    firmwareRevision: string;
    manufacturer: string;
    model: string;
    name: string;
    serialNumber: string;
}

type SmartBridgeEvents = {
    unsolicited: (bridgeID: string, response: Response) => void;
    disconnected: () => void;
}

export class SmartBridge extends (EventEmitter as new () => TypedEmitter<SmartBridgeEvents>) {
    private pingLooper: ReturnType<typeof setInterval> | null = null;

    constructor(public readonly bridgeID: string, public client: LeapClient) {
        super();
        logDebug('new bridge', bridgeID, 'being constructed');
        client.on('unsolicited', this._handleUnsolicited.bind(this));
        client.on('disconnected', this._handleDisconnect.bind(this));

        this.startPingLoop();
    }

    private startPingLoop(): void {
        this.pingLooper = setInterval((): void => {
            const pingPromise = this.client.request('ReadRequest', '/server/1/status/ping');
            const timeoutPromise = new Promise((resolve, reject): void => {
                setTimeout((): void => {
                    reject('Ping timeout');
                }, PING_TIMEOUT_MS);
            });

            Promise.race([pingPromise, timeoutPromise])
                .then(resp => {
                    // if the ping succeeds, there's not really anything to do.
                    logDebug("Ping succeeded", resp);
                })
                .catch(e => {
                    // if it fails, however, what do we do? the client's
                    // behavior is to attempt to re-open the connection if it's
                    // lost. that means calling `this.client.close()` might
                    // clobber in-flight requests made between the ping timing
                    // out and the attempt to close it. that's bad.
                    //
                    // I think the answer is: nothing. future attempts to use
                    // the client will block (and potentially eventually time
                    // out), and we don't ever want to prevent that happening
                    // unless specifically requested.
                    logDebug("Ping failed:", e);
                });

        }, PING_INTERVAL_MS);

    }

    public start(): void {
        // not much to do here, but it needs to exist if close exists.
        if (this.pingLooper === null) {
            logDebug("Bridge starting");
            this.startPingLoop();
        }
    }

    public close(): void {
        // much as with LeapClient.close, this method will not actually prevent
        // some caller from causing the client to reconnect. all this really
        // does is tell the client to close the socket, and kills the
        // keep-alive loop.
        logDebug('bridge id', this.bridgeID, 'closing');
        if (this.pingLooper !== null) {
            clearTimeout(this.pingLooper);
            this.pingLooper = null;
        }
        this.client.close();
    }

    public async ping(): Promise<Response> {
        return await this.client.request('ReadRequest', '/server/1/status/ping');
    }

    public async getHref(href: Href): Promise<BodyType> {
        logDebug(`client getting href ${href.href}`);
        const raw = await this.client.request('ReadRequest', href.href);
        return raw.Body!;
    }

    public async getBridgeInfo(): Promise<BridgeInfo> {
        logDebug('getting bridge information');
        const raw = await this.client.request('ReadRequest', '/device/1');
        if ((raw.Body! as OneDeviceDefinition).Device) {
            const device = (raw.Body! as OneDeviceDefinition).Device;
            return {
                firmwareRevision: device.FirmwareImage.Firmware.DisplayName,
                manufacturer: 'Lutron Electronics Co., Inc',
                model: device.ModelNumber,
                name: device.FullyQualifiedName.join(' '),
                serialNumber: device.SerialNumber,
            };
        }
        throw new Error('Got bad response to bridge info request');
    }

    public async getDeviceInfo(): Promise<DeviceDefinition[]> {
        logDebug('getting info about all devices');
        const raw = await this.client.request('ReadRequest', '/device');
        if ((raw.Body! as MultipleDeviceDefinition).Devices) {
            const devices = (raw.Body! as MultipleDeviceDefinition).Devices;
            return devices;
        }
        throw new Error('got bad response to all device list request');
    }

    public async setBlindsTilt(device: DeviceDefinition, value: number): Promise<void> {
        const href = device.LocalZones[0].href + '/commandprocessor';
        logDebug('setting href', href, 'to value', value);
        this.client.request('CreateRequest', href, {
            Command: {
                CommandType: 'GoToTilt',
                TiltParameters: {
                    Tilt: Math.round(value),
                },
            },
        });
    }

    public async readBlindsTilt(device: DeviceDefinition): Promise<number> {
        const resp = await this.client.request('ReadRequest', device.LocalZones[0].href + '/status');
        const val = (resp.Body! as OneZoneStatus).ZoneStatus.Tilt;
        logDebug('read tilt for device', device.FullyQualifiedName.join(' '), 'at', val);
        return val;
    }

    /* A device has a list of ButtonGroup Hrefs. This method maps them to
     * (promises for) the actual ButtonGroup objects themselves.
     */
    public async getButtonGroupsFromDevice(
        device: DeviceDefinition,
    ): Promise<(ButtonGroupDefinition | ExceptionDetail)[]> {
        return Promise.all(
            device.ButtonGroups.map((bgHref: Href) =>
                this.client.request('ReadRequest', bgHref.href).then((resp: Response) => {
                    switch (resp.CommuniqueType) {
                        case 'ExceptionResponse':
                            return resp.Body! as ExceptionDetail;
                        case 'ReadResponse':
                            return (resp.Body! as OneButtonGroupDefinition).ButtonGroup;
                        default:
                            throw new Error('Unexpected communique type');
                    }
                }),
            ),
        );
    }

    /* Similar to getButtonGroupsFromDevice, a ButtonGroup contains a list of
     * Button Hrefs. This maps them to (promises for) the actual Button
     * objects themselves.
     */
    public async getButtonsFromGroup(bgroup: ButtonGroupDefinition): Promise<ButtonDefinition[]> {
        return Promise.all(
            bgroup.Buttons.map((button: ButtonDefinition) =>
                this.client
                    .request('ReadRequest', button.href)
                    .then((resp: Response) => (resp.Body! as OneButtonDefinition).Button),
            ),
        );
    }

    public subscribeToButton(button: ButtonDefinition, cb: (r: Response) => void) {
        this.client.subscribe(button.href + '/status/event', cb);
    }

    /* Because we can't subscribe to individual occupancysensors, we have to
     * subscribe to everything and handle routing elsewhere. As such, this will
     * call `cb` every time any sensor changes.
     */
    public async subscribeToOccupancy(cb: (r: Response) => void): Promise<MultipleOccupancyGroupStatus> {
        this.client.subscribe('/occupancygroup/status', cb).catch((e) => {
            logDebug('ignoring failed subscription because response is not tagged');
        });

        return this.client
            .request('ReadRequest', '/occupancygroup/status')
            .then((resp: Response) => resp.Body! as MultipleOccupancyGroupStatus);
    }

    private _handleUnsolicited(response: Response) {
        logDebug('bridge', this.bridgeID, 'got unsolicited message:');
        logDebug(response);
        this.emit('unsolicited', this.bridgeID, response);
    }

    private _handleDisconnect(): void {
        // nothing to do here
        logDebug('bridge id', this.bridgeID, 'disconnected.');
    }

}

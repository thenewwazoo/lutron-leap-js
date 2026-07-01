import debug from 'debug';
import * as retry from 'async-retry';
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
    MultipleControlStationDefinition,
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
const CONNECT_MAX_RETRY = 20;

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
};

export class SmartBridge extends (EventEmitter as new () => TypedEmitter<SmartBridgeEvents>) {
    private pingLooper: ReturnType<typeof setInterval> | null = null;
    public bridgeReconfigInProgress: boolean;

    constructor(public readonly bridgeID: string, public client: LeapClient) {
        super();
        logDebug('new bridge', bridgeID, 'being constructed');
        this.bridgeReconfigInProgress = false;
        client.on('unsolicited', this._handleUnsolicited.bind(this));
        client.on('disconnected', this._handleDisconnect.bind(this));
        this.startPingLoop();
    }
    public async reconfigureBridge(newClient: LeapClient) {
        this.bridgeReconfigInProgress = true;
        const oldClient = this.client;
        // close the old client's connections and remove its references to the bridge so it can be GC'd
        this.pingLooper = null;
        oldClient.drain();
        // replace the old client with the new
        this.client = newClient;
        this.client.on('unsolicited', this._handleUnsolicited.bind(this));
        this.client.on('disconnected', this._handleDisconnect.bind(this));
        // Make a new connection with the bridge, retry to make sure we get it
        // A freshly boot bridge will refuses the connection during several seconds
        await retry(
            async () => {
                logDebug('Connecting ...');
                await this.client.connect();
                logDebug('Connected');
            },
            { retries: CONNECT_MAX_RETRY, factor: 1 },
        );
        // Send disconnect signal for re-subscribing
        this.emit('disconnected');
        this.startPingLoop();
        this.bridgeReconfigInProgress = false;
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
                .then((resp) => {
                    // if the ping succeeds, there's not really anything to do.
                    logDebug('Ping succeeded', resp);
                })
                .catch((e) => {
                    // A failed or timed-out keep-alive ping means the LEAP
                    // session is dead, even though the underlying TCP socket may
                    // still look ESTABLISHED (a half-open connection, e.g. after
                    // the bridge briefly changes address during a router reboot).
                    // Nothing else will detect this: the socket never emits
                    // 'close'/'error'/'end', so LeapClient never emits
                    // 'disconnected' and the client never reconnects. The ping is
                    // the only signal we get, so act on it.
                    //
                    // Close the client to force recovery. `LeapClient.close()`
                    // ends the socket, which emits 'disconnected' (triggering
                    // re-subscription) and causes the next request to reconnect.
                    // The previous concern about clobbering in-flight requests
                    // does not apply here: a timed-out ping means the connection
                    // is already dead, so any in-flight requests are already
                    // doomed and will be retried after the reconnect.
                    logDebug('Ping failed; closing client to force reconnect:', e);
                    this.client.close();
                });
        }, PING_INTERVAL_MS);
    }

    public start(): void {
        // not much to do here, but it needs to exist if close exists.
        if (this.pingLooper === null) {
            logDebug('Bridge starting');
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
        const raw = await this.client.request('ReadRequest', '/device?where=IsThisDevice:true');
        if (
            (raw.Body! as MultipleDeviceDefinition).Devices &&
            (raw.Body! as MultipleDeviceDefinition).Devices.length > 0
        ) {
            const device = (raw.Body! as MultipleDeviceDefinition).Devices[0];
            return {
                firmwareRevision: device.FirmwareImage.Firmware.DisplayName,
                manufacturer: 'Lutron Electronics Co., Inc',
                model: device.ModelNumber,
                name: device.FullyQualifiedName?.join(' ') || device.Name,
                serialNumber: device.SerialNumber,
            };
        }
        // Fallback to old method for backwards compatibility
        const rawFallback = await this.client.request('ReadRequest', '/device/1');
        if ((rawFallback.Body! as OneDeviceDefinition).Device) {
            const device = (rawFallback.Body! as OneDeviceDefinition).Device;
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

        // 1. Try standard /device list
        let standardDevices: DeviceDefinition[] = [];
        try {
            const raw = await this.client.request('ReadRequest', '/device');

            // Check if we got a 204 NoContent response (common with QSX)
            if (raw.Header.StatusCode?.code === 204) {
                logDebug('Got 204 NoContent, device list is empty or not supported on this processor');
            } else if ((raw.Body! as MultipleDeviceDefinition).Devices) {
                standardDevices = (raw.Body! as MultipleDeviceDefinition).Devices;
            }
        } catch (e) {
            logDebug('Standard /device request failed or returned empty. Proceeding to QSX check.');
        }

        // 2. Map for Deduplication
        const deviceMap = new Map<string, DeviceDefinition>();
        for (const d of standardDevices) {
            deviceMap.set(d.href, d);
        }

        // 3. QSX Check
        // If the list is empty or small, we assume it's QSX (or a fresh bridge) and crawl.
        if (standardDevices.length <= 5) {
            const qsxDevices = await this.discoverQSXDevices();
            for (const d of qsxDevices) {
                deviceMap.set(d.href, d);
            }
        }

        return Array.from(deviceMap.values());
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
        // If ButtonGroups is missing (common on QSX crawled devices),
        // return an empty list immediately to prevent the .map() crash.
        if (!device.ButtonGroups) {
            return Promise.resolve([]);
        }

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
            bgroup.Buttons.map((button: Href) =>
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
        this.emit('disconnected');
    }

    /**
     * QSX Helper: Crawl areas to find devices hidden from the main /device endpoint.
     */
    private async discoverQSXDevices(): Promise<DeviceDefinition[]> {
        logDebug('QSX detected: Starting Area crawl for device discovery...');
        const foundDevices: DeviceDefinition[] = [];

        // 1. Get all Areas
        let areas: any[] = [];
        try {
            // @ts-ignore
            const areaRaw = await this.client.request('ReadRequest', '/area');
            // @ts-ignore
            areas = areaRaw.Body.Areas || [];
        } catch (e) {
            return [];
        }

        // 2. Scan each area
        const stationPromises = areas.map(async (area) => {
            if (!area.href) return;

            try {
                const url = `${area.href}/associatedcontrolstation`;
                // @ts-ignore
                const response = await this.client.request('ReadRequest', url);
                const body = response.Body as MultipleControlStationDefinition;

                if (body && body.ControlStations) {
                    for (const station of body.ControlStations) {
                        if (station.AssociatedGangedDevices) {
                            for (const gang of station.AssociatedGangedDevices) {
                                // @ts-ignore
                                const device = gang.Device || gang;

                                if (device && device.href) {
                                    // Build the name from area/station FIRST (before fetching full details)
                                    const areaName = (area as any).Name || 'Area';
                                    const stationName = station.Name || 'Station';
                                    const partialDeviceName = device.Name || stationName;
                                    const builtName = [areaName, partialDeviceName];

                                    // For devices that might have zones/buttons, fetch full details
                                    // to avoid overwriting important fields
                                    const needsFullDetails =
                                        device.DeviceType === 'PlugInDimmer' ||
                                        device.DeviceType === 'WallDimmer' ||
                                        device.DeviceType === 'PlugInSwitch';

                                    let fullDevice = device;
                                    if (needsFullDetails) {
                                        try {
                                            const resp = await this.client.request('ReadRequest', device.href);
                                            if (resp.Body && (resp.Body as OneDeviceDefinition).Device) {
                                                fullDevice = (resp.Body as OneDeviceDefinition).Device;
                                            }
                                        } catch (e) {
                                            // If fetch fails, continue with partial device
                                            logDebug(`Failed to fetch full device details for ${device.href}`);
                                        }
                                    }

                                    // Always use the area-based name we built, not the generic device name
                                    fullDevice.FullyQualifiedName = builtName;

                                    if (!fullDevice.SerialNumber) {
                                        fullDevice.SerialNumber = fullDevice.href.split('/').pop() || '000000';
                                    }
                                    if (!fullDevice.ModelNumber) {
                                        fullDevice.ModelNumber = fullDevice.DeviceType || 'QSX Device';
                                    }

                                    // We force these to be arrays if they are missing
                                    if (!fullDevice.ButtonGroups) fullDevice.ButtonGroups = [];
                                    if (!fullDevice.LocalZones) fullDevice.LocalZones = [];
                                    if (!fullDevice.OccupancySensors) fullDevice.OccupancySensors = [];
                                    if (!fullDevice.LinkNodes) fullDevice.LinkNodes = [];
                                    if (!fullDevice.DeviceRules) fullDevice.DeviceRules = [];

                                    if (!fullDevice.AssociatedArea) {
                                        fullDevice.AssociatedArea = { href: area.href };
                                    }

                                    foundDevices.push(fullDevice as DeviceDefinition);
                                }
                            }
                        }
                    }
                }
            } catch (e) {
                // Ignore errors
            }
        });

        await Promise.all(stationPromises);
        return foundDevices;
    }
}

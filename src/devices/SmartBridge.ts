import debug from 'debug';
import * as util from 'util';

import { ButtonDefinition, OneZoneStatus, Response, DeviceDefinition, LeapClient, MultipleDeviceDefinition, MultipleVirtualButtonDefinition, VirtualButtonDefinition } from '../index';

import { LutronDevice, reifyDevice } from './DeviceClasses';
import { VirtualButton } from './VirtualButton';

const logDebug = debug('leap:device:bridge');

type RespCb = (Response) => void;

export class CasetaSmartBridge {
    public static LEAP_PORT: number = 8081;
    public device?: DeviceDefinition = undefined;

    private buttonCallbacks: Map<string, RespCb> = new Map();
    private zoneCallbacks: Map<string, RespCb> = new Map();
    private firehoseCallbacks: Array<RespCb> = new Array();

    constructor(public readonly bridgeID: string, private client: LeapClient) {
        this.client.on('unsolicited', this.handleUnsolicited.bind(this));
    }

    public firehose(cb: RespCb): void {
        this.firehoseCallbacks.push(cb);
    }

    private handleUnsolicited(response: Response): void {
        logDebug("router got a response of type", response.CommuniqueType);

        for (const cb of this.firehoseCallbacks) {
            logDebug("router firehosing");
            cb(response);
        }

        if (response.Header.MessageBodyType === 'OneZoneStatus') {
            const href = (response.Body as OneZoneStatus)?.ZoneStatus?.Zone?.href;
            logDebug('router recognized this as a zone status update about', href);
            if (this.zoneCallbacks.has(href)) {
                logDebug("router triggering callback for", href);
                this.zoneCallbacks.get(href)!(response);
            }
        } else {
            logDebug(`unsolicited reponse without known body type: ${util.inspect(response, true, null)}`);
        }
    }

    public registerButton(btn: ButtonDefinition, cb: RespCb): void {
        // the client handles routing button-specific event types (i.e. there
        // is no need to inspect events to see if it's a ButtonStatusEvent)
        // because such events are associated with a callback by a tag that's
        // assigned at subscription time
        this.client.subscribe(btn.href + '/status/event', cb);
    }

    public registerZone(device: DeviceDefinition, cb: RespCb): void {
        logDebug("registering callback for", device.FullyQualifiedName.join(" "), "at", device.href);
        this.zoneCallbacks.set(device.LocalZones[0].href, cb);
    }

    public async getDevices(): Promise<LutronDevice[]> {
        logDebug('getting info about all devices');
        const raw = await this.client.request('ReadRequest', '/device');

        if ((raw.Body! as MultipleDeviceDefinition).Devices) {
            const devices = (raw.Body! as MultipleDeviceDefinition).Devices;
            var result: LutronDevice[] = [];
            for (const device of devices) {
                if (device.IsThisDevice) {
                    this.device = device;
                    continue;
                }

                const reified = await reifyDevice(device, this, this.client);

                if (reified instanceof Error) {
                    logDebug(reified);
                    continue;
                }
                result.push(reified);
            }
            return result;
        }

        throw new Error('got bad response to all device list request');
    }

    public async getScenes(): Promise<VirtualButton[]> {
        logDebug('getting all scenes');
        const raw = await this.client.request('ReadRequest', '/virtualbutton');
        const vbuttons: MultipleVirtualButtonDefinition = await this.client.retrieve({href: '/virtualbutton'});
        return vbuttons
            .VirtualButtons
            .filter((vbtn: VirtualButtonDefinition) => vbtn.IsProgrammed)
            .map((vbtn: VirtualButtonDefinition): VirtualButton => new VirtualButton(vbtn, this, this.client));
    }
}

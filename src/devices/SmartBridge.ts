import debug from 'debug';
import * as util from 'util';

import {
    ButtonDefinition,
    DeviceDefinition,
    Href,
    LeapClient,
    MultipleDeviceDefinition,
    MultipleOccupancyGroupStatus,
    MultipleVirtualButtonDefinition,
    OccupancyGroupStatus,
    OccupancyStatus,
    OneOccupancySensorDefinition,
    OneZoneStatus,
    Response,
    ResponseWithTag,
    VirtualButtonDefinition,
} from '../index';

import { WallDimmer } from './WallDimmer';
import { PicoRemote } from './PicoRemote';
import { SerenaTiltOnlyWoodBlind } from './SerenaTiltOnlyWoodBlind';
import { RPSOccupancySensor } from './RPSOccupancySensor';

import { LutronDevice } from './DeviceClasses';
import { VirtualButton } from './VirtualButton';

const logDebug = debug('leap:device:bridge');

type RespCb = (resp: Response) => void;
type OGSCb = (ogs: OccupancyGroupStatus) => void;

export class CasetaSmartBridge implements LutronDevice {
    public static LEAP_PORT: number = 8081;
    public device?: DeviceDefinition = undefined;

    private zoneCallbacks: Map<string, RespCb> = new Map();
    private firehoseCallbacks: Array<RespCb> = new Array();

    private occupancyGroupCallbacks: Map<string, OGSCb> = new Map();
    public occGrpStatus: Map<Href, OccupancyStatus> = new Map();

    constructor(public readonly bridgeID: string, private client: LeapClient) {
        this.client.on('unsolicited', this.handleUnsolicited.bind(this));

        this.client.subscribe(
            "/occupancygroup/status",
            this.handleOccupancyGroupUpdate.bind(this),
        ).then((taggedResp: ResponseWithTag) => {
            this.handleOccupancyGroupUpdate(taggedResp.response);
        });
    }

    get name(): string {
        if (this.device !== undefined) {
            return this.device.FullyQualifiedName.join(' ');
        } else {
            throw new Error('device not yet reified');
        }
    }

    get deviceType(): string {
        if (this.device !== undefined) {
            return this.device.DeviceType;
        } else {
            throw new Error('device not yet reified');
        }
    }

    get serialNumber(): string {
        if (this.device !== undefined) {
            return this.device.SerialNumber;
        } else {
            throw new Error('device not yet reified');
        }
    }

    get modelNumber(): string {
        if (this.device !== undefined) {
            return this.device.ModelNumber;
        } else {
            throw new Error('devices not yet reified');
        }
    }

    public firehose(cb: RespCb): void {
        this.firehoseCallbacks.push(cb);
    }

    private handleUnsolicited(response: Response): void {
        logDebug('router got a response of type', response.CommuniqueType);

        for (const cb of this.firehoseCallbacks) {
            logDebug('router firehosing');
            cb(response);
        }

        if (response.Header.MessageBodyType === 'OneZoneStatus') {
            const href = (response.Body as OneZoneStatus)?.ZoneStatus?.Zone?.href;
            logDebug('router recognized this as a zone status update about', href);
            if (this.zoneCallbacks.has(href)) {
                logDebug('router triggering callback for', href);
                this.zoneCallbacks.get(href)!(response);
            }
        } else if (response.Header.MessageBodyType === 'MultipleOccupancyGroupStatus') {
            this.handleOccupancyGroupUpdate(response);
        } else {
            logDebug(`unsolicited reponse without known body type: ${util.inspect(response, true, null)}`);
        }
    }

    public registerButton(btn: ButtonDefinition, cb: RespCb): void {
        // the LeapClient code handles routing button-specific event types
        // (i.e. there is no need to inspect events to see if it's a
        // ButtonStatusEvent in handleUnsolicited) because such events are
        // associated with a callback by a tag that's assigned at subscription
        // time
        this.client.subscribe(btn.href + '/status/event', cb);
    }

    public registerZone(device: DeviceDefinition, cb: RespCb): void {
        // in contrast to registerButton, you can't subscribe to a zone and
        // provide tag for the client to use for routing. you're automatically
        // subscribed to all zones at connection time, and updates come
        // untagged. therefore, "unsolicited" messages (lacking a tag) have to
        // be inspected a receipt time and routed in handleUnsolicited.
        logDebug('registering callback for', device.FullyQualifiedName.join(' '), 'at', device.href);
        this.zoneCallbacks.set(device.LocalZones[0].href, cb);
    }

    public registerOccupancyGroups(occGrpHrefs: Href[], cb: OGSCb) {
        for (const href of occGrpHrefs) {
            this.occupancyGroupCallbacks.set(href.href, cb);
        }
    }

    public triggerUpdate(): void {
        // That's right, we can't actually request status information for an
        // occupancy sensor. Why? Who knows. `/occupancygroup/#/status` gives a
        // 400, and `/occupancysensor/#/status` gives a 500! It literally
        // throws an error. As a result, this function updates all sensors.
        // Whatever, it's cheap.
        //
        // Instead of inspecting the MultipleOccupancyGroupStatus, we just get a
        // response and pass it through the machinery. If there's an update,
        // it'll arrive to each sensor via handleUpdate (from the bridge).
        this.client.request('ReadRequest', '/occupancygroup/status').then((r: Response) => {
            this.handleOccupancyGroupUpdate(r);
        });
    }

    handleOccupancyGroupUpdate(resp: Response) {
        if (resp.Header.MessageBodyType === 'MultipleOccupancyGroupStatus') {
            const statuses = (resp.Body! as MultipleOccupancyGroupStatus).OccupancyGroupStatuses;
            for (const status of statuses) {
                const cb = this.occupancyGroupCallbacks.get(status.OccupancyGroup.href);
                this.occGrpStatus.set(status.OccupancyGroup, status.OccupancyStatus);
                if (cb !== undefined) {
                    cb(status);
                }
            }
        } else {
            throw new Error(`unexpected response passed to handleOccupancyGroupUpdate: ${util.inspect(resp, true, 0)}`);
        }
    }

    public async getDevices(): Promise<(LutronDevice | Error)[]> {
        logDebug('getting info about all devices');
        const raw = await this.client.request('ReadRequest', '/device');

        if ((raw.Body! as MultipleDeviceDefinition).Devices) {
            const devices = (raw.Body! as MultipleDeviceDefinition).Devices;
            var result: (LutronDevice | Error)[] = [];
            for (const device of devices) {
                switch (device.DeviceType) {
                    case 'SmartBridge':
                    case 'SmartBridgePro': {
                        this.device = device;
                        result.push(this);
                        break;
                    }

                    case 'WallDimmer': {
                        result.push(new WallDimmer(device, this, this.client));
                        break;
                    }

                    case 'SerenaTiltOnlyWoodBlind': {
                        result.push(new SerenaTiltOnlyWoodBlind(device, this, this.client));
                        break;
                    }

                    case 'Pico2Button':
                    case 'Pico2ButtonRaiseLower':
                    case 'Pico3Button':
                    case 'Pico3ButtonRaiseLower':
                    case 'Pico4Button2Group':
                    case 'Pico4ButtonScene':
                    case 'Pico4ButtonZone': {
                        result.push(new PicoRemote(device, this, this.client));
                        break;
                    }

                    case 'RPSOccupancySensor': {
                        // listed devices include occupancysensors, but status updates come with information about
                        // occupancygroups. instead of storing the mapping explicitly, get the sensor from the group
                        // and just hook up the event handler here

                        /*
                         *  From /devices:
                         *     +-----------------+
                         *     |DeviceDefinition |
                         *     +-----------------+           +-------------------------+
                         *     |Href             |           |OccupancySensorDefinition|
                         *     |OccupancySensors +------+    +-------------------------+          +------------------------+
                         *     +-----------------+      +--->|Href                     |          |OccupancyGroupDefinition|
                         *                              |    |OccupancyGroups          +-----+    +------------------------+
                         *                              |    +-------------------------+     +--->|Href                    |
                         *                              |                                    |    +------------------------+
                         *                              |    +-------------------------+     |
                         *                              |    |OccupancySensorDefinition|     |    +------------------------+
                         *                              |    +-------------------------+     |    |OccupancyGroupDefinition|
                         *                              +--->|Href                     |     |    +------------------------+
                         *                                   |OccupancyGroups          |     +--->|Href                    |<-----+
                         *                                   +-------------------------+          +------------------------+      |
                         *                                                                                                        |
                         *                                                                                                        |
                         * After subscribing to /occupancygroup/status:                                                           |
                         *  +--------------------+                                                                                |
                         *  |OccupancyGroupStatus|                                                                                |
                         *  +--------------------+                                                                                |
                         *  |Href                |                                                                                |
                         *  |OccupancyGroup      +--------------------------------------------------------------------------------+
                         *  |OccupancyStatus     |
                         *  +--------------------+
                         */

                        // DeviceDefinition has list of OccupancySensors
                        const occSnsDev = new RPSOccupancySensor(device, this, this.client);
                        for (const occSns of device.OccupancySensors) {
                            // OccupancySensorDefinition has list of OccupancyGroups
                            const occDefn = await this.client.retrieve<OneOccupancySensorDefinition>(occSns);
                            // link OccupancyGroupStatus updates containing an OccupancyGroup to the RPSOccupancySensor object
                            this.registerOccupancyGroups(occDefn.OccupancySensor.OccupancyGroups, occSnsDev.handleUpdate.bind(occSnsDev));
                            occSnsDev.addGroups(occDefn.OccupancySensor.OccupancyGroups);
                        }

                        result.push(occSnsDev);
                        break;
                    }

                    default:
                        result.push(new Error(`unsupported device type ${device.DeviceType}`));
                }
            }
            return result;
        }

        throw new Error('got bad response to all device list request');
    }

    public async getScenes(): Promise<VirtualButton[]> {
        logDebug('getting all scenes');
        const raw = await this.client.request('ReadRequest', '/virtualbutton');
        const vbuttons: MultipleVirtualButtonDefinition = await this.client.retrieve({ href: '/virtualbutton' });
        return vbuttons.VirtualButtons.filter((vbtn: VirtualButtonDefinition) => vbtn.IsProgrammed).map(
            (vbtn: VirtualButtonDefinition): VirtualButton => new VirtualButton(vbtn, this, this.client),
        );
    }
}

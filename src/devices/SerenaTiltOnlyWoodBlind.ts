
import debug from 'debug';
import { CommuniqueType, DeviceDefinition, LeapClient, OneZoneStatus, Response } from '../index';
import { EventEmitter } from 'events';
import TypedEmitter from 'typed-emitter';

import {
    Tiltable,
} from './DeviceClasses';
import { CasetaSmartBridge } from './SmartBridge';

const logDebug = debug('leap:device:serenatiltonlywoodblind');

type TiltEvents = {
    tilt: (angle: number) => void;
}

export class SerenaTiltOnlyWoodBlind extends (EventEmitter as new () => TypedEmitter<TiltEvents>) implements Tiltable {
    public name: string;

    constructor(private device: DeviceDefinition, private bridge: CasetaSmartBridge, private client: LeapClient) {
        super();

        this.name = device.FullyQualifiedName.join(" ");
        this.bridge.registerZone(this.device, this.handleUpdate.bind(this));
    }

    async setTilt(angle: number): Promise<void> {
        if (angle < 0 || angle > 100) {
            throw new Error(`tilt ${angle} out of range, must be from 0 to 100`);
        }

        const href = this.device.LocalZones[0].href + '/commandprocessor';
        this.client.request('CreateRequest', href, {
            Command: {
                CommandType: 'GoToTilt',
                TiltParameters: {
                    Tilt: Math.round(angle),
                },
            },
        });
    }

    async getTilt(): Promise<number> {
        const s: OneZoneStatus = await this.client.retrieve(this.device.LocalZones[0], "/status");
        return s.ZoneStatus.Tilt;
    }

    public handleUpdate(resp: Response) {
        const tilt = (resp.Body! as OneZoneStatus).ZoneStatus.Tilt;
        logDebug(this.name, "got update of tilt", tilt);
        this.emit('tilt', tilt);
    }
}

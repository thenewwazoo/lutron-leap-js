import * as util from 'util';

import debug from 'debug';
import { CommuniqueType, DeviceDefinition, LeapClient, OneZoneStatus, Response } from '../index';
import { EventEmitter } from 'events';
import TypedEmitter from 'typed-emitter';

import { Light } from './DeviceClasses';
import { CasetaSmartBridge } from './SmartBridge';

const logDebug = debug('leap:device:light');

/*
    {
      Name: 'Fan Light',
      DeviceType: 'WallDimmer',
      AssociatedArea: { href: '/area/10' },
      href: '/device/27',
      SerialNumber: 63969571,
      FullyQualifiedName: [ 'Office', 'Fan Light' ],
      Parent: { href: '/project' },
      ModelNumber: 'PD-5NE-XX',
      LocalZones: [ { href: '/zone/20' } ],
      LinkNodes: [ { href: '/device/27/linknode/27' } ],
      DeviceRules: [ { href: '/devicerule/53' } ],
      AddressedState: 'Addressed'
    },
 */

type LightEvents = {
    change: (value: number) => void;
};

export class WallDimmer extends (EventEmitter as new () => TypedEmitter<LightEvents>) implements Light {
    constructor(private device: DeviceDefinition, private bridge: CasetaSmartBridge, private client: LeapClient) {
        super();

        this.bridge.registerZone(device, this.handleUpdate.bind(this));
    }

    public get name(): string {
        return this.device.FullyQualifiedName.join(' ');
    }

    private handleUpdate(response: Response): void {
        const value = (response.Body! as OneZoneStatus).ZoneStatus.Level;
        logDebug('Light', this.device.LocalZones[0].href, 'changed to value', value);
        this.emit('change', value);
    }

    async setOn(fade?: number): Promise<void> {
        return this.setBrightness(100, fade);
    }

    async setOff(fade?: number): Promise<void> {
        return this.setBrightness(0, fade);
    }

    async setBrightness(value: number, fade?: number): Promise<void> {
        if (value < 0 || value > 100) {
            throw new Error('invalid value');
        }

        const href = this.device.LocalZones[0].href + '/commandprocessor';
        const command = {
            Command: {
                CommandType: 'GoToLevel',
                Parameter: [
                    {
                        Type: 'Level',
                        Value: value,
                    },
                ],
            },
        };
        this.client.request('CreateRequest', href, command);
    }

    async getBrightness(): Promise<number> {
        console.log('the thing is', util.inspect(this.device.LocalZones[0], true, undefined));
        console.log(Object.getOwnPropertyNames(this.device.LocalZones[0]));
        const zoneStatus: OneZoneStatus = await this.client.retrieve(this.device.LocalZones[0], '/status');
        return zoneStatus.ZoneStatus.Level;
    }
}

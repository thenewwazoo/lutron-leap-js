import { EventEmitter } from 'events';
import TypedEmitter from 'typed-emitter';

import {
    Href,
    OccupancyStatus,
    OccupancyGroupStatus,
    OccupancySensorDefinition,
    OneOccupancySensorDefinition,
    LeapClient,
    OneZoneStatus,
    Response,
    DeviceDefinition,
} from '../index';
import { OccupancySensor } from './DeviceClasses';
import { CasetaSmartBridge } from './SmartBridge';

type OccupancyEvents = {
    change: (status: OccupancyStatus) => void;
};

export class RPSOccupancySensor
    extends (EventEmitter as new () => TypedEmitter<OccupancyEvents>)
    implements OccupancySensor
{
    private occupancyGroups: Array<Href> = new Array();

    constructor(private device: DeviceDefinition, private bridge: CasetaSmartBridge, private client: LeapClient) {
        super();
    }

    get name(): string {
        return this.device.FullyQualifiedName.join(' ');
    }

    get deviceType(): string {
        return this.device.DeviceType;
    }

    get serialNumber(): string {
        return this.device.SerialNumber;
    }

    get modelNumber(): string {
        return this.device.ModelNumber;
    }

    public addGroups(grps: Href[]) {
        this.occupancyGroups.push.apply(this.occupancyGroups, grps);
    }

    get status(): OccupancyStatus {
        // a sensor can (for whatever reason) have multiple occupancygroups.
        // check them all, and believe any that say 'Occupied'. If none do,
        // then believe any that say 'Unoccupied'. Otherwise, unknown.
        let result: OccupancyStatus = 'Unknown';

        for (const grp of this.occupancyGroups) {
            const status = this.bridge.occGrpStatus.get(grp);
            if (status !== undefined) {
                switch (status) {
                    case 'Occupied': {
                        result = status;
                        break;
                    }
                    case 'Unoccupied': {
                        if (result !== 'Occupied') {
                            result = status;
                        }
                        // occupied takes priority over unoccupied
                        break;
                    }
                    case 'Unknown': // no-op
                        break;
                }
            }
        }
        return result;
    }

    handleUpdate(ogs: OccupancyGroupStatus) {
        this.emit('change', this.status);
    }

}

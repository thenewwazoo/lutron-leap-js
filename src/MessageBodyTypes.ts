/* tslint:disable:max-classes-per-file */

import debug = require('debug');

const logDebug = debug('leap:message:bodytype');

export class UnimplementedMessageBodyType {
    constructor(public type: string) {}
}

export type MessageBodyType =
    | 'OneDeviceDefinition'
    | 'MultipleDeviceDefinition'
    | 'OneZoneStatus'
    | 'OnePingResponse'
    | 'ExceptionDetail';

export class OneDeviceDefinition {
    Device!: Device;
}

export class MultipleDeviceDefinition {
    Devices: Device[] = [];
}

export class OneZoneStatus {
    ZoneStatus!: ZoneStatus;
}

export class OnePingResponse {
    PingResponse!: {
        LEAPVersion: number;
    };
}

export class ExceptionDetail {
    Message = '';
}

export type BodyType =
    | OneDeviceDefinition
    | MultipleDeviceDefinition
    | OneZoneStatus
    | OnePingResponse
    | ExceptionDetail;

export function parseBody(type: MessageBodyType, data: object): BodyType {
    logDebug('parsing body type', type, 'with data:', data);
    let theType;
    switch (type) {
        case 'OneDeviceDefinition':
            theType = OneDeviceDefinition;
            break;
        case 'MultipleDeviceDefinition':
            theType = MultipleDeviceDefinition;
            break;
        case 'ExceptionDetail':
            theType = ExceptionDetail;
            break;
        case 'OneZoneStatus':
            theType = OneZoneStatus;
            break;
        case 'OnePingResponse':
            theType = OnePingResponse;
            break;
        default:
            throw new UnimplementedMessageBodyType(type as string);
    }
    return Object.assign(new theType, data);
}

type Href = {
    href: string;
};

export type Device = Href & {
    Name: string;
    FullyQualifiedName: string[];
    Parent: Href;
    SerialNumber: string;
    ModelNumber: string;
    DeviceType: string;
    LocalZones: Href[];
    AssociatedArea: Href;
    OccupancySensors: Href[];
    LinkNodes: Href[];
    DeviceRules: Href[];
    RepeaterProperties: {
        IsRepeater: boolean;
    };
    FirmwareImage: {
        Firmware: {
            DisplayName: string;
        };
        Installed: {
            Year: number;
            Month: number;
            Day: number;
            Hour: number;
            Minute: number;
            Second: number;
            Utc: string;
        };
    };

};

type OnOrOff =
    | 'On'
    | 'Off';

type FanSpeedType =
    | 'High'
    | 'MediumHigh'
    | 'Medium'
    | 'Low'
    | 'Off';

type ZoneStatus = Href & {
    Level: number;
    SwitchedLevel: 'On' | 'Off';
    FanSpeed: FanSpeedType;
    Zone: Href;
    StatusAccuracy: 'Good';
};

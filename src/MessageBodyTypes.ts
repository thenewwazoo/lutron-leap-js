/* tslint:disable:max-classes-per-file */

import debug = require('debug');
import util = require('util');

const logDebug = debug('leap:message:bodytype');

export class UnimplementedMessageBodyType {
    constructor(public type: string) {}
}

export type MessageBodyType =
    | 'OneProjectDefinition'
    | 'OnePresetDefinition'
    | 'OneAreaSceneDefinition'
    | 'OneLinkDefinition'
    | 'OneLinkNodeDefinition'
    | 'MultipleLinkNodeDefinition'
    | 'MultipleLinkDefinition'
    | 'OneControlStationDefinition'
    | 'OneAreaDefinition'
    | 'MultipleAreaDefinition'
    | 'OneAreaStatus'
    | 'MultipleAreaStatus'
    | 'OneDeviceStatus'
    | 'OneDeviceDefinition'
    | 'MultipleDeviceDefinition'
    | 'OneZoneDefinition'
    | 'MultipleZoneDefinition'
    | 'OneZoneStatus'
    | 'MultipleZoneStatus'
    | 'OnePingResponse'
    | 'OneButtonGroupDefinition'
    | 'OneButtonDefinition'
    | 'OneButtonStatusEvent'
    | 'MultipleOccupancyGroupStatus'
    | 'OneOccupancyGroupDefinition'
    | 'ExceptionDetail';

export class OneDeviceStatus {
    DeviceStatus!: DeviceStatus;
}

export class OneAreaSceneDefinition {
    AreaScene!: AreaSceneDefinition;
}

export class OnePresetDefinition {
    Preset!: PresetDefinition;
}

export class OneLinkDefinition {
    LinkNode!: LinkNodeDefinition;
}

export class OneLinkNodeDefinition {
    LinkNode!: LinkNodeDefinition;
}

export class MultipleLinkNodeDefinition {
    Links!: LinkNodeDefinition[];
}

export class MultipleLinkDefinition {
    Links!: LinkNodeDefinition[];
}

export class OneDeviceDefinition {
    Device!: DeviceDefinition;
}

export class MultipleDeviceDefinition {
    Devices: DeviceDefinition[] = [];
}

export class MultipleAreaDefinition {
    Areas: AreaDefinition[] = [];
}

export class OneZoneDefinition {
    Zone!: ZoneDefinition;
}

export class MultipleZoneDefinition {
    Zones: ZoneDefinition[] = [];
}

export class OneProjectDefinition {
    Project!: ProjectDefinition;
}

export class OneAreaStatus {
    AreaStatus!: AreaStatus;
}

export class MultipleAreaStatus {
    AreaStatuses!: AreaStatus[];
}

export class OneAreaDefinition {
    Area!: AreaDefinition;
}

export class OneControlStationDefinition {
    ControlStation!: ControlStationDefinition;
}

export class OneZoneStatus {
    ZoneStatus!: ZoneStatus;
}

export class MultipleZoneStatus {
    ZonsStatuses!: ZoneStatus[];
}

export class OnePingResponse {
    PingResponse!: {
        LEAPVersion: number;
    };
}

export class OneButtonGroupDefinition {
    ButtonGroup!: ButtonGroupDefinition;
}

export class OneButtonDefinition {
    Button!: ButtonDefinition;
}

export class OneButtonStatusEvent {
    ButtonStatus!: ButtonStatus;
}

export class MultipleOccupancyGroupStatus {
    OccupancyGroupStatuses!: OccupancyGroupStatus[];
}

export class OneOccupancyGroupDefinition {
    OccupancyGroup!: OccupancyGroupDefinition;
}

export class ExceptionDetail {
    Message = '';
}

export type BodyType =
    | OneProjectDefinition
    | OnePresetDefinition
    | OneAreaSceneDefinition
    | OneLinkDefinition
    | OneLinkNodeDefinition
    | MultipleLinkNodeDefinition
    | MultipleLinkDefinition
    | OneZoneDefinition
    | MultipleZoneDefinition
    | OneAreaDefinition
    | MultipleAreaDefinition
    | OneControlStationDefinition
    | OneAreaStatus
    | MultipleAreaStatus
    | OneDeviceStatus
    | OneDeviceDefinition
    | MultipleDeviceDefinition
    | OneZoneStatus
    | MultipleZoneStatus
    | OnePingResponse
    | OneButtonGroupDefinition
    | OneButtonDefinition
    | OneButtonStatusEvent
    | MultipleOccupancyGroupStatus
    | OccupancyGroupDefinition
    | ExceptionDetail;

export function parseBody(type: MessageBodyType, data: object): BodyType {
    logDebug('parsing body type', type, 'with data:', util.inspect(data, { depth: null }));
    let theType;
    switch (type) {
        case 'OneDeviceDefinition':
            theType = OneDeviceDefinition;
            break;
        case 'OnePresetDefinition':
            theType = OnePresetDefinition;
            break;
        case 'OneAreaSceneDefinition':
            theType = OneAreaSceneDefinition;
            break;
        case 'MultipleAreaDefinition':
            theType = MultipleAreaDefinition;
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
        case 'MultipleZoneStatus':
            theType = MultipleZoneStatus;
            break;
        case 'OnePingResponse':
            theType = OnePingResponse;
            break;
        case 'OneButtonGroupDefinition':
            theType = OneButtonGroupDefinition;
            break;
        case 'OneButtonDefinition':
            theType = OneButtonDefinition;
            break;
        case 'OneButtonStatusEvent':
            theType = OneButtonStatusEvent;
            break;
        case 'OneDeviceStatus':
            theType = OneDeviceStatus;
            break;
        case 'OneZoneDefinition':
            theType = OneZoneDefinition;
            break;
        case 'MultipleZoneDefinition':
            theType = MultipleZoneDefinition;
            break;
        case 'OneAreaDefinition':
            theType = OneAreaDefinition;
            break;
        case 'OneAreaStatus':
            theType = OneAreaStatus;
            break;
        case 'MultipleAreaStatus':
            theType = MultipleAreaStatus;
            break;
        case 'OneControlStationDefinition':
            theType = OneControlStationDefinition;
            break;
        case 'OneProjectDefinition':
            theType = OneProjectDefinition;
            break;
        case 'OneLinkDefinition':
            theType = OneLinkDefinition;
            break;
        case 'OneLinkNodeDefinition':
            theType = OneLinkNodeDefinition;
            break;
        case 'MultipleLinkNodeDefinition':
            theType = MultipleLinkNodeDefinition;
            break;
        case 'MultipleLinkDefinition':
            theType = MultipleLinkDefinition;
            break;
        case 'MultipleOccupancyGroupStatus':
            theType = MultipleOccupancyGroupStatus;
            break;
        case 'OneOccupancyGroupDefinition':
            theType = OneOccupancyGroupDefinition;
            break;
        default:
            throw new UnimplementedMessageBodyType(type as string);
    }
    return Object.assign(new theType(), data);
}

export type Href = {
    href: string;
};

type PhaseSetting = Href & {
    Direction: string;
};

type TuningSetting = Href & {
    HighEndTrim: number;
    LowEndTrim: number;
};

export type Zone = Href & {
    AssociatedArea: Href;
    ControlType: string;
    Name: string;
    PhaseSettings: PhaseSetting;
    SortOrder: number;
    TuningSettings: TuningSetting;
};

export type AffectedZone = Href & {
    ButtonGroup: ButtonGroupDefinition;
    Zone: Zone;
};

type AdvancedToggleProperties = {
    PrimaryPreset: Href;
    SecondaryPreset: Href;
};

type DualActionProperties = {
    PressPreset: Href;
    ReleasePreset: Href;
};

type ProgrammingModel = Href & {
    AdvancedToggleProperties: AdvancedToggleProperties;
    DualActionProperties: DualActionProperties;
    Name: string;
    Parent: Href;
    Preset: Href;
    ProgrammingModelType: string;
};

export type ButtonDefinition = Href & {
    AssociatedLED: Href;
    ButtonNumber: number;
    Engraving: { Text: string };
    Name: string;
    Parent: Href;
    ProgrammingModel: ProgrammingModel;
};

export type ButtonGroupDefinition = Href & {
    AffectedZones: AffectedZone[];
    Buttons: ButtonDefinition[];
    Parent: DeviceDefinition;
    ProgrammingType: string;
    SortOrder: number;
    StopIfMoving: string;
};

export type ButtonStatus = Href & {
    Button: Href;
    ButtonEvent: { EventType: 'Press' | 'Release' | 'LongHold' };
};

export type DeviceDefinition = Href & {
    Name: string;
    FullyQualifiedName: string[];
    Parent: Href;
    SerialNumber: string;
    ModelNumber: string;
    DeviceType: string;
    ButtonGroups: Href[];
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

type OnOrOff = 'On' | 'Off';

type FanSpeedType = 'High' | 'MediumHigh' | 'Medium' | 'Low' | 'Off';

type ZoneStatus = Href & {
    CCOLevel: 'Open' | 'Closed';
    Level: number;
    SwitchedLevel: 'On' | 'Off';
    FanSpeed: FanSpeedType;
    Zone: Href;
    StatusAccuracy: 'Good';
    AssociatedArea: Href;
    Availability: 'Available' | 'Unavailable' | 'Mixed' | 'Unknown';
    Tilt: number;
};

type ZoneDefinition = Href & {
    Name: string;
    ControlType: string;
    Category: { Type: string; IsLight: boolean };
    Device: Href;
    AssociatedFacade: Href;
};

export type DeviceStatus = Href & {
    DeviceHeard: DeviceHeard;
    // Device: Device;
    // BatteryStatus: BatteryStatus;
    // FailedTransfers: FailedTransfer[];
};

export type DeviceHeard = {
    DiscoveryMechanism: 'UserInteraction' | 'UnassociatedDeviceDiscovery' | 'Unknown';
    SerialNumber: string;
    DeviceType: string;
    ModelNumber: string; // ???
    // EngravingKit: string;
    // UnassociatedDeviceDiscoverSession: Href;
    // PairedDevices: PairedDevice[]
};

type AreaStatus = Href & {
    Level: number;
    OccupancyStatus: string;
    CurrentScene: Href;
};

type AreaDefinition = Href & {
    Name: string;
    ControlType: string;
    Parent: Href;
    AssociatedZones: Href[];
    AssociatedControlStations: Href[];
    AssociatedOccupancyGroups: Href[];
};

type ControlStationDefinition = Href & {
    Name: string;
    ControlType: string;
    Parent: Href;
    AssociatedArea: Href;
    SortOrder: number;
    AssociatedGangedDevices: DeviceDefinition[];
};

type ProjectDefinition = Href & {
    Name: string;
    ControlType: string;
    ProductType: string;
    Contacts: Href[];
    TimeclockEventRules: Href;
    ProjectModifiedTimestamp: {
        Year: number;
        Month: number;
        Day: number;
        Hour: number;
        Minute: number;
        Second: number;
        Utc: 'string';
    };
};

type LinkNodeDefinition = Href & {
    Parent: Href;
    LinkType: string;
    SortOrder: number;
    // RFProperties: {json}
    AssociatedLink: Href;
    ClearConnectTypeXLinkProperties: {
        PANID: number;
        ExtendedPANID: string;
        Channel: number;
        NetworkName: string;
        NetworkMasterKey: string;
    };
};

type AreaSceneDefinition = Href & {
    Name: string;
    Parent: Href;
    Preset: Href;
    SortOrder: number;
};

type PresetDefinition = Href & {
    Parent: Href;
};

export type OccupancyStatus = 'Occupied' | 'Unoccupied' | 'Unknown';

export type OccupancyGroupStatus = Href & {
    OccupancyGroup: OccupancyGroupDefinition;
    OccupancyStatus: OccupancyStatus;
};

type OccupancyGroupDefinition = Href & {
    AssociatedAreas?: AssociatedArea[];
    AssociatedSensors?: AssociatedSensor[];
    ProgrammingModel?: Href;
    ProgrammingType?: string;
    OccupiedActionSchedule?: { ScheduleType: string }; // nfi
    UnoccupiedActionSchedule?: { ScheduleType: string }; // also nfi
};

type AssociatedArea = Href & {
    Area: Href;
};

type AssociatedSensor = Href & {
    OccupancySensor: Href;
};

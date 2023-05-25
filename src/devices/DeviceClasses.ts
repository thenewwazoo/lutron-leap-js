import { WallDimmer } from './WallDimmer';
import { PicoRemote } from './PicoRemote';
import { SerenaTiltOnlyWoodBlind } from './SerenaTiltOnlyWoodBlind';
import { CasetaSmartBridge } from './SmartBridge';
import { RPSOccupancySensor } from './RPSOccupancySensor';

import { OneOccupancySensorDefinition, LeapClient, Href, DeviceDefinition, OccupancyStatus } from '../index';

export interface LutronDevice {
    get name(): string;
    get deviceType(): string;
    get serialNumber(): string;
    get modelNumber(): string;
}

export interface Light {
    setOn(fade: number | undefined): Promise<void>;
    setOff(fade: number | undefined): Promise<void>;
    setBrightness(value: number, fade: number | undefined): Promise<void>;
    getBrightness(): Promise<number>;
}

export interface Tiltable {
    setTilt(angle: number): Promise<void>;
    getTilt(): Promise<number>;
}

export interface OccupancySensor {
    status: OccupancyStatus;
}

import { WallDimmer } from './WallDimmer';
import { PicoRemote } from './PicoRemote';
import { SerenaTiltOnlyWoodBlind } from './SerenaTiltOnlyWoodBlind';
import { CasetaSmartBridge } from './SmartBridge';

import { LeapClient, Href, DeviceDefinition } from '../index';

export type LutronDevice = CasetaSmartBridge | WallDimmer | SerenaTiltOnlyWoodBlind | PicoRemote;

export async function reifyDevice(defn: DeviceDefinition, bridge: CasetaSmartBridge, client: LeapClient): Promise<LutronDevice | Error> {
    switch (defn.DeviceType) {

        case 'SmartBridge':
        case 'SmartBridgePro': {
            bridge.device = defn;
            return bridge;
        }

        case 'WallDimmer':
            return new WallDimmer(defn, bridge, client);

        case 'SerenaTiltOnlyWoodBlind':
            return new SerenaTiltOnlyWoodBlind(defn, bridge, client);

        case 'Pico2Button':
        case 'Pico2ButtonRaiseLower':
        case 'Pico3Button':
        case 'Pico3ButtonRaiseLower':
        case 'Pico4Button2Group':
        case 'Pico4ButtonScene':
        case 'Pico4ButtonZone': {
            return new PicoRemote(defn, bridge, client);
        }

        default:
            return new Error(`unknown device type ${defn.DeviceType}`);
    }
}

export interface Light {
    setOn(fade: number | undefined): Promise<void>;
    setOff(fade: number | undefined): Promise<void>;
    setBrightness(value: number, fade: number | undefined): Promise<void>;
    getBrightness(): Promise<number>;
}

export interface Tiltable {
    setTilt(angle: number): Promise<void>;
    getTilt(): Promise<number>
}

// Implements a LEAP "virtual button", namely, a scene. In the Lutron mobile
// application, virtualbuttons are used to make Scenes work. They're also used
// as the backing mechanism for arrival/departure automations.

import debug from 'debug';
import {
    Href,
    Response,
    BodyType,
    VirtualButtonDefinition,
    OneProgrammingModelDefinition,
    OnePresetDefinition,
    OnePresetAssignmentDefinition,
    OneFanSpeedAssignmentDefinition,
    OneTiltAssignmentDefinition,
    ExceptionDetail,
    OneZoneStatus,
    LeapClient,
} from '../index';
import { EventEmitter } from 'events';
import TypedEmitter from 'typed-emitter';

import { CasetaSmartBridge } from './SmartBridge';

const logDebug = debug('leap:device:caseta:scene');

export class VirtualButton {
    public readonly name: string;

    constructor(private device: VirtualButtonDefinition, private bridge: CasetaSmartBridge, private client: LeapClient) {

        this.name = device.Name;
    }

    // Trigger the scene
    async activate(): Promise<void> {
        this.client.request('CreateRequest', this.device.href + '/commandprocessor', {
            Command: {
                CommandType: 'PressAndRelease',
            },
        });
    }

    // Implements a heuristic to determine whether the scene is active.
    //
    // This operates by basically inspecting the various components of the scene,
    // and seeing if they match. Unfortunately, LEAP isn't quite consistent
    // enough to make this elegant or DRY. The checks here match known Caseta
    // devices in the wild, namely lights, fans, and tilt-only shades. A
    // more-comprehensive iteration should probably be done in the future, but I
    // don't own the necessary devices to test them.
    async getIsActive(): Promise<boolean> {
        try {
            const programmingModel: OneProgrammingModelDefinition = await this.client.retrieve(
                this.device.ProgrammingModel,
            );
            const preset: OnePresetDefinition = await this.client.retrieve(
                programmingModel.ProgrammingModel.Preset,
            );

            if (preset.Preset.PresetAssignments !== undefined) {
                for (const presetAssignmentHref of preset.Preset.PresetAssignments) {
                    const presetAssignment: OnePresetAssignmentDefinition = await this.client.retrieve(
                        presetAssignmentHref,
                    );
                    if (presetAssignment.PresetAssignment.AffectedZone !== undefined) {
                        const tgtLevel = presetAssignment.PresetAssignment.Level;
                        const zoneStatus: OneZoneStatus = await this.client.retrieve(
                            presetAssignment.PresetAssignment.AffectedZone,
                            '/status',
                        );

                        if (zoneStatus.ZoneStatus.Level !== tgtLevel) {
                            return false;
                        }
                    }
                }
            }

            if (preset.Preset.FanSpeedAssignments !== undefined) {
                for (const fanSpeedAssignmentHref of preset.Preset.FanSpeedAssignments) {
                    const fanSpeedAssignment: OneFanSpeedAssignmentDefinition = await this.client.retrieve(
                        fanSpeedAssignmentHref,
                    );
                    const tgtLevel = fanSpeedAssignment.FanSpeedAssignment.Speed;
                    const zoneStatus: OneZoneStatus = await this.client.retrieve(
                        fanSpeedAssignment.FanSpeedAssignment.AssignableResource,
                        '/status',
                    );
                    if (zoneStatus.ZoneStatus.FanSpeed !== tgtLevel) {
                        return false;
                    }
                }
            }

            if (preset.Preset.TiltAssignments !== undefined) {
                for (const tiltAssignmentHref of preset.Preset.TiltAssignments) {
                    const tiltAssignment: OneTiltAssignmentDefinition = await this.client.retrieve(
                        tiltAssignmentHref,
                    );
                    const tgtLevel = tiltAssignment.TiltAssignment.Tilt;
                    const zoneStatus: OneZoneStatus = await this.client.retrieve(
                        tiltAssignment.TiltAssignment.AssignableResource,
                        '/status',
                    );

                    if (zoneStatus.ZoneStatus.Tilt !== tgtLevel) {
                        return false;
                    }
                }
            }
        } catch (e) {
            logDebug('failed to check scene status', e);

            return false;
        }

        return true;
    }
}

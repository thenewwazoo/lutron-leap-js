import debug from 'debug';
import * as util from 'util';

import {
    OneButtonDefinition,
    OneButtonStatusEvent,
    Href,
    OneButtonGroupDefinition,
    ButtonDefinition,
    CommuniqueType,
    DeviceDefinition,
    LeapClient,
    OneZoneStatus,
    Response,
} from '../index';
import { EventEmitter } from 'events';
import TypedEmitter from 'typed-emitter';

import { CasetaSmartBridge } from './SmartBridge';
import { Button } from './PicoButton';


export class PicoRemote {
    private buttons: Button[] | undefined;
    public isAssociated: boolean | undefined;

    constructor(private device: DeviceDefinition, private bridge: CasetaSmartBridge, private client: LeapClient) {}

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

    public async getButtons(): Promise<Button[]> {
        if (this.buttons !== undefined) {
            return this.buttons;
        }

        let buttons = new Array();

        for (const bgHref of this.device.ButtonGroups) {
            const bg: OneButtonGroupDefinition = await this.client.retrieve(bgHref);

            if (bg.ButtonGroup.AffectedZones.length > 0) {
                this.isAssociated = true;
            } else {
                this.isAssociated = false;
            }

            const btnHrefs: Array<Href> = bg.ButtonGroup.Buttons;
            for (const btnHref of btnHrefs) {
                const btnDef: OneButtonDefinition = await this.client.retrieve(btnHref);
                const btn = new Button(btnDef.Button, this.name, this.client);

                // register the button
                this.bridge.registerButton(btnDef.Button, btn.handleEvent.bind(btn));

                // and if the client connection is reset, re-register
                this.client.on('disconnected', () => {
                    this.bridge.registerButton(btnDef.Button, btn.handleEvent.bind(btn));
                });

                buttons.push(btn);
            }
        }

        this.buttons = buttons;

        return this.buttons;
    }
}

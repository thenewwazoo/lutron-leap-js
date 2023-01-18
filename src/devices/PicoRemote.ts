import debug from 'debug';
import * as util from 'util';

import { OneButtonDefinition, OneButtonStatusEvent, Href, OneButtonGroupDefinition, ButtonDefinition, CommuniqueType, DeviceDefinition, LeapClient, OneZoneStatus, Response } from '../index';
import { EventEmitter } from 'events';
import TypedEmitter from 'typed-emitter';

import { CasetaSmartBridge } from './SmartBridge';

const logDebug = debug('leap:device:picoremote');

type ButtonEvents = {
    // press indicates that the button was pressed down
    press: (button: number) => void;
    // hold may follow press and indicates that the button was not released
    hold: (button: number) => void;
    // release either follows press (PressAndRelease) or hold (PressAndHold)
    // and indicates that the button was released
    release: (button: number) => void;
};

export class Button extends (EventEmitter as new () => TypedEmitter<ButtonEvents>) {
    constructor(private buttonDefn: ButtonDefinition, private picoName: string, private bridge: CasetaSmartBridge, private client: LeapClient) {
        super();
    }

    get name(): string {
        return `${this.picoName} ${this.buttonDefn.Name}`;
    }

    public async press(): Promise<void> {
        this.client.request(
            "CreateRequest",
            this.buttonDefn.href + "/commandprocessor",
            {
                Command: {
                    CommandType: "PressAndHold"
                }
            }
        );
    }

    public async release(): Promise<void> {
        this.client.request(
            "CreateRequest",
            this.buttonDefn.href + "/commandprocessor",
            {
                Command: {
                    CommandType: "Release"
                }
            }
        );
    }

    public async tap(): Promise<void> {
        this.client.request(
            "CreateRequest",
            this.buttonDefn.href + "/commandprocessor",
            {
                Command: {
                    CommandType: "PressAndRelease"
                }
            }
        );
    }

    public handleEvent(response: Response): void {
        const evt = (response.Body! as OneButtonStatusEvent).ButtonStatus;
        switch (evt.ButtonEvent.EventType) {
            case 'Press':
                this.emit('press', this.buttonDefn.ButtonNumber);
            break;
            case 'Release':
                this.emit('release', this.buttonDefn.ButtonNumber);
            break;
            case 'LongHold':
                this.emit('hold', this.buttonDefn.ButtonNumber);
            break;
            default:
                logDebug(`unknown event type ${evt.ButtonEvent.EventType}`);
        }

    }
}

export class PicoRemote  {
    private buttons: Button[] | undefined;
    public isAssociated: boolean | undefined;

    constructor(private device: DeviceDefinition, private bridge: CasetaSmartBridge, private client: LeapClient) {}

    get name(): string {
        return this.device.FullyQualifiedName.join(" ");
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
                const btn = new Button(btnDef.Button, this.name, this.bridge, this.client);

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

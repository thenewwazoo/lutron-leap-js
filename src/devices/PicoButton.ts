import debug from 'debug';

import {
    OneButtonStatusEvent,
    ButtonDefinition,
    LeapClient,
    Response,
} from '../index';

import { EventEmitter } from 'events';
import TypedEmitter from 'typed-emitter';

const logDebug = debug('leap:device:picobutton');

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
    constructor(
        private buttonDefn: ButtonDefinition,
        private picoName: string,
        private client: LeapClient,
    ) {
        super();
    }

    get buttonNumber(): number {
        return this.buttonDefn.ButtonNumber;
    }

    get name(): string {
        return `${this.picoName} ${this.buttonDefn.Name}`;
    }

    public async press(): Promise<void> {
        this.client.request('CreateRequest', this.buttonDefn.href + '/commandprocessor', {
            Command: {
                CommandType: 'PressAndHold',
            },
        });
    }

    public async release(): Promise<void> {
        this.client.request('CreateRequest', this.buttonDefn.href + '/commandprocessor', {
            Command: {
                CommandType: 'Release',
            },
        });
    }

    public async tap(): Promise<void> {
        this.client.request('CreateRequest', this.buttonDefn.href + '/commandprocessor', {
            Command: {
                CommandType: 'PressAndRelease',
            },
        });
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
        }
    }
}

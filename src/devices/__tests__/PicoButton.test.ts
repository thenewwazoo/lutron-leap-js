import { Button } from '../PicoButton';
import { ButtonDefinition, LeapClient, OneButtonDefinition, OneButtonStatusEvent, Response } from '../../index';
import { CasetaSmartBridge } from '../SmartBridge';

describe('button registration', () => {

    const oneButtonDef: OneButtonDefinition = {
        Button: {
            href: '/button/120',
            ButtonNumber: 4,
            ProgrammingModel: { href: '/programmingmodel/154' },
            Parent: { href: '/buttongroup/5' },
            Name: 'Button 5',
        },
    } as OneButtonDefinition;

    const mockClient = {
        subscribe: jest.fn(),
        on: jest.fn(),
    };

    let sentinalFn = jest.fn();

    const bridge = new CasetaSmartBridge("someid", mockClient as unknown as LeapClient);
    bridge.registerButton(oneButtonDef.Button, sentinalFn);

    expect(mockClient.subscribe).toBeCalledWith(oneButtonDef.Button.href + '/status/event', sentinalFn);
});


test('button getters', () => {
    const mockButtonDefn = {
        ButtonNumber: 100,
        Name: 'abutton',
        href: '/href',
    };

    const mockClient = {};

    const btn = new Button(mockButtonDefn as ButtonDefinition, 'piconame', mockClient as LeapClient);

    expect(btn.buttonNumber).toEqual(mockButtonDefn.ButtonNumber);
    expect(btn.name).toEqual('piconame ' + mockButtonDefn.Name);
});

test('button ops', () => {
    const mockButtonDefn = {
        ButtonNumber: 100,
        Name: 'abutton',
        href: '/href',
    };

    const mockClient = {
        request: jest.fn(),
    };

    const btn = new Button(mockButtonDefn as ButtonDefinition, 'piconame', mockClient as unknown as LeapClient);

    btn.press();
    btn.release();
    btn.tap();

    expect(mockClient.request).toHaveBeenCalledTimes(3);
});

test('button events', () => {
    const mockButtonDefn = {
        ButtonNumber: 100,
        Name: 'abutton',
        href: '/href',
    };

    const mockClient = {};

    const btn = new Button(mockButtonDefn as ButtonDefinition, 'piconame', mockClient as LeapClient);

    let pressed: number | undefined = undefined;
    let released: number | undefined = undefined;
    let longheld: number | undefined = undefined;

    btn.on('press', (button: number) => {
        pressed = button;
    });

    btn.on('release', (button: number) => {
        released = button;
    });

    btn.on('hold', (button: number) => {
        longheld = button;
    });

    let mockResp = new Response();
    mockResp.Body = new OneButtonStatusEvent();
    mockResp.Body.ButtonStatus = {
        href: 'href',
        Button: { href: 'buttonhref' },
        ButtonEvent: { EventType: 'Press' },
    };

    btn.handleEvent(mockResp); // Press

    mockResp.Body.ButtonStatus.ButtonEvent.EventType = 'Release';

    btn.handleEvent(mockResp); // Release

    mockResp.Body.ButtonStatus.ButtonEvent.EventType = 'LongHold';

    btn.handleEvent(mockResp); // LongHold

    expect(pressed).toEqual(mockButtonDefn.ButtonNumber);
    expect(released).toEqual(mockButtonDefn.ButtonNumber);
    expect(longheld).toEqual(mockButtonDefn.ButtonNumber);
});

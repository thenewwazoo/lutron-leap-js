import { PicoRemote } from '../PicoRemote';
import { CasetaSmartBridge } from '../SmartBridge';
import {
    AffectedZone,
    ButtonDefinition,
    ButtonStatus,
    DeviceDefinition,
    LeapClient,
    OneButtonDefinition,
    OneButtonGroupDefinition,
    OneButtonStatusEvent,
    Response,
} from '../../index';

import { Button } from '../PicoButton';
jest.mock('../PicoButton');
const mockButton = Button as jest.Mock<Button>;

export const oneButtonDef: OneButtonDefinition = {
    Button: {
        href: '/button/120',
        ButtonNumber: 4,
        ProgrammingModel: { href: '/programmingmodel/154' },
        Parent: { href: '/buttongroup/5' },
        Name: 'Button 5',
    },
} as OneButtonDefinition;

test('pico getters', () => {
    let mockDeviceDefn = {
        FullyQualifiedName: ['Fully', 'Qualified', 'Name'],
        DeviceType: 'PicoRemote',
        SerialNumber: '123456789',
        ModelNumber: '42',
    };

    const mockBridge = {};
    const mockClient = {};

    const remote = new PicoRemote(
        mockDeviceDefn as DeviceDefinition,
        mockBridge as CasetaSmartBridge,
        mockClient as LeapClient,
    );

    expect(remote.name).toEqual('Fully Qualified Name');
    expect(remote.deviceType).toEqual(mockDeviceDefn.DeviceType);
    expect(remote.serialNumber).toEqual(mockDeviceDefn.SerialNumber);
    expect(remote.modelNumber).toEqual(mockDeviceDefn.ModelNumber);
});

describe('getting buttons', () => {
    const picoDevice = {
        Name: 'Blinds',
        DeviceType: 'Pico3ButtonRaiseLower',
        AssociatedArea: { href: '/area/6' },
        href: '/device/22',
        SerialNumber: 60802410,
        FullyQualifiedName: ['Living Room', 'Blinds'],
        Parent: { href: '/project' },
        ModelNumber: 'PJ2-3BRL-GXX-X01',
        ButtonGroups: [{ href: '/buttongroup/5' }],
        LinkNodes: [{ href: '/device/22/linknode/22' }],
        DeviceRules: [{ href: '/devicerule/25' }],
        AddressedState: 'Addressed',
    };

    var affzones: AffectedZone[] = [];
    var oneBG = {
        ButtonGroup: {
            href: '/buttongroup/5',
            Buttons: [{ href: '/button/120' }],
            AffectedZones: affzones,
            Parent: { href: '/device/22' },
            SortOrder: 0,
            StopIfMoving: 'Enabled',
            Category: { Type: 'Shades' },
            ProgrammingType: 'Column',
        },
    };

    const mockBridge = {
        registerButton: jest.fn(),
    };

    const mockClient = {
        retrieve: jest.fn(),
        on: jest.fn().mockImplementation((event, handler) => {
            handler(oneButtonDef.Button.ButtonNumber);
        }),
    };

    let remote: PicoRemote;

    beforeEach(() => {
        mockClient.retrieve.mockReturnValueOnce(oneBG).mockReturnValueOnce(oneButtonDef);
        mockButton.mockClear();
        mockClient.retrieve.mockClear();
        mockClient.on.mockClear();
        mockBridge.registerButton.mockClear();

        remote = new PicoRemote(
            picoDevice as unknown as DeviceDefinition,
            mockBridge as unknown as CasetaSmartBridge,
            mockClient as unknown as LeapClient,
        );
    });

    test('uncached buttons, associated', () => {
        expect(remote.isAssociated).toBeUndefined();

        oneBG.ButtonGroup.AffectedZones = [
            {
                href: '/buttongroup/5/affectedzone/15',
                Zone: { href: '/zone/15' },
            } as AffectedZone,
        ];

        remote.getButtons().then((btns: Button[]) => {
            expect(btns.length).toEqual(1);
            expect(mockClient.retrieve).toHaveBeenCalledTimes(
                picoDevice.ButtonGroups.length + oneBG.ButtonGroup.Buttons.length,
            );
            expect(mockClient.on).toHaveBeenCalledTimes(1);

            // plus one because we mock mockClient.on by having it call the
            // callback immediately. in this case, the callback is
            // mockBridge.registerButton
            expect(mockBridge.registerButton).toHaveBeenCalledTimes(oneBG.ButtonGroup.Buttons.length + 1);

            expect(Button).toHaveBeenCalledTimes(1); // one button, one construction
            expect(Button).toHaveBeenCalledWith(oneButtonDef.Button, remote.name, mockClient);
            expect(remote.isAssociated).toBeTruthy();
        });
    });

    test('uncached buttons, not associated', () => {
        expect(remote.isAssociated).toBeUndefined();

        oneBG.ButtonGroup.AffectedZones = [];

        remote.getButtons().then((btns: Button[]) => {
            expect(btns.length).toEqual(1);
            expect(mockClient.retrieve).toHaveBeenCalledTimes(
                picoDevice.ButtonGroups.length + oneBG.ButtonGroup.Buttons.length,
            );
            expect(mockClient.on).toHaveBeenCalledTimes(1);

            // plus one because we mock mockClient.on by having it call the
            // callback immediately. in this case, the callback is
            // mockBridge.registerButton
            expect(mockBridge.registerButton).toHaveBeenCalledTimes(oneBG.ButtonGroup.Buttons.length + 1);

            expect(Button).toHaveBeenCalledTimes(1); // one button, one construction
            expect(Button).toHaveBeenCalledWith(oneButtonDef.Button, remote.name, mockClient);
            expect(remote.isAssociated).toBeFalsy();

            // check that the buttons are indeed cached
            remote.getButtons().then((same_btns) => {
                expect(same_btns).toBe(btns);
            });
        });
    });
});

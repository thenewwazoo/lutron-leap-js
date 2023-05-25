import { SerenaTiltOnlyWoodBlind } from '../SerenaTiltOnlyWoodBlind';
import { DeviceDefinition, LeapClient } from '../../index';
import { CasetaSmartBridge } from '../SmartBridge';

const device: DeviceDefinition = {
    Name: 'Left Window',
    DeviceType: 'SerenaTiltOnlyWoodBlind',
    AssociatedArea: { href: '/area/10' },
    href: '/device/25',
    SerialNumber: '51045717',
    FullyQualifiedName: ['Office', 'Left Window'],
    Parent: { href: '/project' },
    ModelNumber: 'SYC-EDU-B-J',
    LocalZones: [{ href: '/zone/19' }],
    LinkNodes: [{ href: '/device/25/linknode/25' }],
    DeviceRules: [{ href: '/devicerule/125' }],
    AddressedState: 'Addressed',
} as DeviceDefinition;

const oneZoneStatus = {
    ZoneStatus: {
        href: '/zone/15/status',
        Tilt: 0,
        Zone: { href: '/zone/15' },
        StatusAccuracy: 'Good',
    },
};

const resp = {
    CommuniqueType: 'ReadResponse',
    Header: {
        MessageBodyType: 'OneZoneStatus',
        StatusCode: '200 OK',
        Url: '/zone/15/status/level',
    },
    Body: oneZoneStatus,
};

describe('blind test', () => {
    let blind;

    const mockBridge = {
        registerZone: jest.fn(),
    };
    const mockClient = {
        request: jest.fn(),
        retrieve: jest.fn(),
    };

    beforeAll(() => {
        blind = new SerenaTiltOnlyWoodBlind(
            device,
            mockBridge as unknown as CasetaSmartBridge,
            mockClient as unknown as LeapClient,
        );
    });

    beforeEach(() => {
        mockClient.request.mockClear();
        mockClient.retrieve.mockClear();
    });

    test('getters', () => {
        expect(blind.name).toEqual(device.FullyQualifiedName.join(' '));
        expect(blind.deviceType).toEqual(device.DeviceType);
        expect(blind.serialNumber).toEqual(device.SerialNumber);
        expect(blind.modelNumber).toEqual(device.ModelNumber);
    });

    test.each([
        { angle: -1, throws: true },
        { angle: 0, throws: false },
        { angle: 10, throws: false },
        { angle: 100, throws: false },
        { angle: 101, throws: true },
    ])('setTilt', (spec) => {
        blind.setTilt(spec.angle).then(
            () => {
                if (spec.throws) {
                    throw new Error('setTilt should have thrown');
                }

                expect(mockClient.request.mock.calls[0][0]).toEqual('CreateRequest');
                expect(mockClient.request.mock.calls[0][1]).toMatch(device.LocalZones[0].href);
                expect(mockClient.request.mock.calls[0][2]).toStrictEqual({
                    Command: {
                        CommandType: 'GoToTilt',
                        TiltParameters: {
                            Tilt: Math.round(spec.angle),
                        },
                    },
                });
            },
            (e: Error) => {
                if (spec.throws) {
                    expect(e.message).toMatch('out of range');
                } else {
                    expect(e).not.toBeInstanceOf(Error);
                }
            },
        );
    });

    test('get tilt', () => {
        mockClient.retrieve.mockReturnValueOnce(Promise.resolve(oneZoneStatus));

        blind.getTilt().then((tilt: number) => {
            expect(tilt).toEqual(oneZoneStatus.ZoneStatus.Tilt);
        });
    });

    test('handle update', () => {
        let emitted = false;

        blind.on('tilt', (angle: number) => {
            expect(angle).toEqual(oneZoneStatus.ZoneStatus.Tilt);
            emitted = true;
        });

        blind.handleUpdate(resp);
        expect(emitted).toBeTruthy();
    });
});

import { LutronDevice } from '../DeviceClasses';
import { CasetaSmartBridge } from '../SmartBridge';
import {
    DeviceDefinition,
    LeapClient,
    Response,
} from '../../index';
import {
    device as occSensorDevDefn,
    globalOccupancySensorUpdateResponseWithTag,
} from './RPSOccupancySensor.test';

import { WallDimmer } from '../WallDimmer';
jest.mock('../WallDimmer');
const mockWallDimmer = WallDimmer as jest.Mock<WallDimmer>;

import { SerenaTiltOnlyWoodBlind } from '../SerenaTiltOnlyWoodBlind';
jest.mock('../SerenaTiltOnlyWoodBlind');
const mockSerena = SerenaTiltOnlyWoodBlind as jest.Mock<SerenaTiltOnlyWoodBlind>;

import { PicoRemote } from '../PicoRemote';
jest.mock('../PicoRemote');
const mockPicoRemote = PicoRemote as jest.Mock<PicoRemote>;

import { RPSOccupancySensor } from '../RPSOccupancySensor';
jest.mock('../RPSOccupancySensor');
const mockOccupancySensor = RPSOccupancySensor as jest.Mock<RPSOccupancySensor>;


const device: DeviceDefinition = {
    Name: "Smart Bridge 2",
    DeviceType: "SmartBridge",
    href: "/device/1",
    SerialNumber: "53378696",
    FullyQualifiedName: [
        "Smart Bridge 2",
    ],
    Parent: {
        href: "/project"
    },
    ModelNumber: "L-BDG2-WH",
    RepeaterProperties: {
        IsRepeater: true
    },
    OwnedLinks: [
        {
            href: "/link/1",
            LinkType: "RF"
        }
    ],
    LinkNodes: [
        {
            href: "/device/1/linknode/1"
        }
    ],
    DeviceRules: [
        {
            href: "/devicerule/40"
        }
    ],
    FirmwareImage: {
        Firmware: {
            DisplayName: "08.08.21f000"
        },
        Installed: {
            Year: 2022,
            Month: 5,
            Day: 19,
            Hour: 2,
            Minute: 15,
            Second: 24,
            Utc: "-7:00:00"
        }
    },
    AddressedState: "Addressed",
    IsThisDevice: true
} as unknown as DeviceDefinition;

describe("smart bridge tests", () => {
    let bridge;

    const mockClient = {
        on: jest.fn(),
        subscribe: jest.fn(),
    };

    beforeEach(() => {
        bridge = new CasetaSmartBridge("id", mockClient as unknown as LeapClient);
        mockClient.on.mockClear();
    });

    test('unreified getters', () => {
        expect(() => bridge.name).toThrow();
        expect(() => bridge.deviceType).toThrow();
        expect(() => bridge.serialNumber).toThrow();
        expect(() => bridge.modelNumber).toThrow();
    });

    test('reified getters', () => {
        bridge.device = device;
        expect(bridge.name).toEqual(device.FullyQualifiedName.join(' '));
        expect(bridge.deviceType).toEqual(device.DeviceType);
        expect(bridge.serialNumber).toEqual(device.SerialNumber);
        expect(bridge.modelNumber).toEqual(device.ModelNumber);
    });

    test('firehose', () => {
        let called = false;
        const mockResp: Response = {
            Header: {
                MessageBodyType: "irrelevant",
            }
        } as unknown as Response;

        const rcb: (resp: Response) => void = (resp) => {
            expect(resp).toBe(mockResp);
            called = true;
        };

        bridge.firehose(rcb);

        bridge.handleUnsolicited(mockResp);

        expect(called).toBeTruthy();
    });

    test('zone status', () => {
        const mockResp = {
            CommuniqueType: "ReadResponse",
            Header: {
                MessageBodyType: "OneZoneStatus",
                StatusCode: "200 OK",
                Url: "/zone/17/status/level"
            },
            Body: {
                ZoneStatus: {
                    href: "/zone/17/status",
                    Tilt: 38,
                    Zone: {
                        href: "/zone/17"
                    },
                    StatusAccuracy: "Good"
                }
            }
        };

        const device = {
            Name: 'Right',
            DeviceType: 'SerenaTiltOnlyWoodBlind',
            AssociatedArea: { href: '/area/6' },
            href: '/device/21',
            SerialNumber: 51045721,
            FullyQualifiedName: [ 'Living Room', 'Right' ],
            Parent: { href: '/project' },
            ModelNumber: 'SYC-EDU-B-J',
            LocalZones: [ { href: '/zone/17' } ],
            LinkNodes: [ { href: '/device/21/linknode/21' } ],
            DeviceRules: [ { href: '/devicerule/125' } ],
            AddressedState: 'Addressed'
        };

        let called = false;
        const rcb: (resp: Response) => void = (resp) => {
            expect(resp).toBe(mockResp);
            called = true;
        };

        bridge.registerZone(device, rcb);
        bridge.handleUnsolicited(mockResp);

        expect(called).toBeTruthy();
    });

    /*
    test('occupancysensor updates', () => {

        expect(bridge.occGrpStatus).toBeUndefined();

        mockClient.subscribe.mockReturnValueOnce(Promise.resolve(globalOccupancySensorUpdateResponseWithTag));
        bridge.handleOccupancyGroupUpdate = jest.fn();
        const rcb: (resp: Response) => void = (resp) => {};
        const occSensHref = occSensorDevDefn.OccupancySensors[0];

        bridge.registerOccupancyGroup(occSensHref, rcb);

        // we have to wait for the promise returned by LeapClient.subscribe
        // (above) to be handled inside registerOccupancyGroup, so we wait for
        // a tick of the event loop
        Promise.resolve().then(() => {
            expect(bridge.occGrpStatus).not.toBeUndefined();
            expect(bridge.handleOccupancyGroupUpdate).toHaveBeenCalledTimes(1);
            expect(bridge.handleOccupancyGroupUpdate).toHaveBeenCalledWith(globalOccupancySensorUpdateResponseWithTag.response);

            expect(bridge.occupancyGroupCallbacks.get(occSensHref.href)).toBe(rcb);
        });
    });

    test('occupancysensor bad update', () => {
        const badRespWithTag = {
            response: {
                Header: {
                    MessageBodyType: "SomethingUnexpected",
                }
            },
            tag: "whatever",
        };

        jest.spyOn(console, 'error').mockImplementation(() => {});
        mockClient.subscribe.mockReturnValueOnce(Promise.resolve(badRespWithTag));
        bridge.handleOccupancyGroupUpdate = jest.fn();
        const rcb: (resp: Response) => void = (resp) => {};
        const occSensHref = occSensorDevDefn.OccupancySensors[0];

        bridge.registerOccupancyGroup(occSensHref, rcb);

        // we have to wait for the promise returned by LeapClient.subscribe
        // (above) to be handled inside registerOccupancyGroup, so we wait for
        // a tick of the event loop
        Promise.resolve().then(() => {
            expect(bridge.occGrpStatus).toBeUndefined();
            expect(bridge.handleOccupancyGroupUpdate).not.toHaveBeenCalled();
            expect(bridge.handleOccupancyGroupUpdate).not.toHaveBeenCalled();

            expect(bridge.occupancyGroupCallbacks.get(occSensHref.href)).toBe(rcb);

            expect(console.error).toHaveBeenCalledTimes(1);

            // @ts-ignore
            console.error.mockRestore();
        });

    });
   */

});

describe('reify some picos', () => {
    beforeEach(() => {
        mockPicoRemote.mockClear();
    });

    const remotes = [
        'Pico2Button',
        'Pico2ButtonRaiseLower',
        'Pico3Button',
        'Pico3ButtonRaiseLower',
        'Pico4Button2Group',
        'Pico4ButtonScene',
        'Pico4ButtonZone',
    ];

    test.each(remotes)('each pico', async (cls: string) => {
        const mockDevice = {
            DeviceType: cls,
        };
        const mockClient = {
            on: jest.fn(),
            request: jest.fn().mockReturnValueOnce({
                Body: {
                    Devices: [mockDevice],
                }
            }),
        };

        const b = new CasetaSmartBridge("someid", mockClient as unknown as LeapClient);

        const devs = await b.getDevices();

        expect(PicoRemote).toHaveBeenCalledTimes(1);
        expect(devs.length).toEqual(1);
    });
});

describe('reify some simple devices', () => {

    type MockDevice = { DeviceType: string };
    type CheckerFn = (m: MockDevice, d: (LutronDevice | Error), b: CasetaSmartBridge) => void;

    const mockDevices: [MockDevice, CheckerFn][] = [
        [{ DeviceType: "SmartBridge", }, (m, d, b) => {
            expect(d).toEqual(b);
            expect(b.device).toEqual(m);
        }],
        [{ DeviceType: "SmartBridgePro", }, (m, d, b) => {
            expect(d).toEqual(b);
            expect(b.device).toEqual(m);
        }],
        [{ DeviceType: "WallDimmer", }, (m, d, b) => {
            expect(WallDimmer).toHaveBeenCalledTimes(1);
        }],
        [{ DeviceType: 'SerenaTiltOnlyWoodBlind', }, (m, d, b) => {
            expect(SerenaTiltOnlyWoodBlind).toHaveBeenCalledTimes(1);
        }],
    ];

    const mockResp: { Body: { Devices: MockDevice[] }} = {
        Body: {
            Devices: [],
        }
    };

    const mockClient = {
        on: jest.fn(),
        request: jest.fn(),
    };

    beforeEach(() => {
        mockClient.on.mockClear();
        mockResp.Body.Devices = new Array();
    });

    test.each(mockDevices)('reify some devices', async (mockDevice: MockDevice, checkerFn: CheckerFn) => {
        mockResp.Body.Devices.push(mockDevice);
        mockClient.request.mockReturnValueOnce(Promise.resolve(mockResp));

        const bridge = new CasetaSmartBridge("whatever", mockClient as unknown as LeapClient);

        const devs = await bridge.getDevices();

        checkerFn(mockDevice, devs[0], bridge);
    });
});

import { RPSOccupancySensor } from '../RPSOccupancySensor';
import { CasetaSmartBridge } from '../SmartBridge';
import { LeapClient, OneOccupancySensorDefinition, DeviceDefinition, OccupancyGroupStatus, OccupancyStatus } from '../../index';

export const device: DeviceDefinition = {
    Name: 'Sensor de movimiento',
    DeviceType: 'RPSOccupancySensor',
    AssociatedArea: { href: '/area/12' },
    href: '/device/37',
    SerialNumber: '52654332',
    FullyQualifiedName: ['Garaje', 'Sensor de movimiento'],
    Parent: { href: '/project' },
    ModelNumber: 'PD-OSENS-XX',
    OccupancySensors: [{ href: '/occupancysensor/1' }],
    LinkNodes: [{ href: '/device/37/linknode/29' }],
    DeviceRules: [{ href: '/devicerule/122' }],
    AddressedState: 'Addressed',
} as DeviceDefinition;

export const occupancySensorDefn: OneOccupancySensorDefinition = {
    OccupancySensor: {
        href: "/occupancysensor/1",
        Parent: {
            href: "/device/37"
        },
        EnabledState: "Enabled",
        OccupancyGroups: [
            {
                href: "/occupancygroup/11"
            }
        ]
    }
};

test('getters', () => {
    const mockClient = {
        retrieve: jest.fn().mockReturnValueOnce(Promise.resolve(occupancySensorDefn)),
    };
    const mockBridge = {
        registerOccupancyGroup: jest.fn(),
    };

    const sensor = new RPSOccupancySensor(
        device,
        mockBridge as unknown as CasetaSmartBridge,
        mockClient as unknown as LeapClient,
    );

    expect(sensor.name).toEqual(device.FullyQualifiedName.join(' '));
    expect(sensor.deviceType).toEqual(device.DeviceType);
    expect(sensor.serialNumber).toEqual(device.SerialNumber);
    expect(sensor.modelNumber).toEqual(device.ModelNumber);
});

describe('status updates', () => {
    const updates: OccupancyGroupStatus[] = [
        {
            href: '/occupancygroup/1/status',
            OccupancyGroup: { href: '/occupancygroup/1' },
            OccupancyStatus: 'Unknown',
        },
        {
            href: '/occupancygroup/1/status',
            OccupancyGroup: { href: '/occupancygroup/1' },
            OccupancyStatus: 'Occupied',
        },
        {
            href: '/occupancygroup/1/status',
            OccupancyGroup: { href: '/occupancygroup/1' },
            OccupancyStatus: 'Unoccupied',
        },
    ];

    const mockClient = {
        retrieve: jest.fn().mockReturnValue(Promise.resolve(occupancySensorDefn)),
    };
    const mockBridge = {
        registerOccupancyGroup: jest.fn(),
    };

    let sensor;
    beforeEach(() => {
        sensor = new RPSOccupancySensor(
            device,
            mockBridge as unknown as CasetaSmartBridge,
            mockClient as unknown as LeapClient,
        );
    });

    test.each(updates)('ogs update', (update: OccupancyGroupStatus) => {
        sensor.on('change', (status: OccupancyStatus) => {
            expect(status).toEqual(update.OccupancyStatus);
        });
        sensor.handleUpdate(update);
        expect(sensor.status).toEqual(update.OccupancyStatus);
    });
});

export const globalOccupancySensorUpdateResponseWithTag = {
    response: {
        CommuniqueType: "SubscribeResponse",
        Header: {
            MessageBodyType: "MultipleOccupancyGroupStatus",
            StatusCode: "200 OK",
            Url: "/occupancygroup/status",
            ClientTag: "6c848591-2e13-46e6-bb84-d88e6d38f720"
        },
        Body: {
            OccupancyGroupStatuses: [
                {
                    href: "/occupancygroup/1/status",
                    OccupancyGroup: {
                        href: "/occupancygroup/1"
                    },
                    OccupancyStatus: "Unknown"
                },
                {
                    href: "/occupancygroup/2/status",
                    OccupancyGroup: {
                        href: "/occupancygroup/2"
                    },
                    OccupancyStatus: "Unknown"
                },
                {
                    href: "/occupancygroup/3/status",
                    OccupancyGroup: {
                        href: "/occupancygroup/3"
                    },
                    OccupancyStatus: "Unknown"
                },
                {
                    href: "/occupancygroup/4/status",
                    OccupancyGroup: {
                        href: "/occupancygroup/4"
                    },
                    OccupancyStatus: "Unknown"
                },
                {
                    href: "/occupancygroup/5/status",
                    OccupancyGroup: {
                        href: "/occupancygroup/5"
                    },
                    OccupancyStatus: "Unknown"
                },
                {
                    href: "/occupancygroup/6/status",
                    OccupancyGroup: {
                        href: "/occupancygroup/6"
                    },
                    OccupancyStatus: "Unknown"
                },
                {
                    href: "/occupancygroup/7/status",
                    OccupancyGroup: {
                        href: "/occupancygroup/7"
                    },
                    OccupancyStatus: "Unknown"
                },
                {
                    href: "/occupancygroup/8/status",
                    OccupancyGroup: {
                        href: "/occupancygroup/8"
                    },
                    OccupancyStatus: "Unknown"
                },
                {
                    href: "/occupancygroup/9/status",
                    OccupancyGroup: {
                        href: "/occupancygroup/9"
                    },
                    OccupancyStatus: "Unknown"
                },
                {
                    href: "/occupancygroup/10/status",
                    OccupancyGroup: {
                        href: "/occupancygroup/10"
                    },
                    OccupancyStatus: "Unknown"
                },
                {
                    href: "/occupancygroup/11/status",
                    OccupancyGroup: {
                        href: "/occupancygroup/11"
                    },
                    OccupancyStatus: "Unoccupied"
                }
            ]
        }
    },
    tag: "6c848591-2e13-46e6-bb84-d88e6d38f720"
};

const occSensStatusUpd = {
    "CommuniqueType": "ReadResponse",
    "Header": {
        "MessageBodyType": "MultipleOccupancyGroupStatus",
        "StatusCode": "200 OK",
        "Url": "/occupancygroup/status",
        "ClientTag": "9cd3301c-a74e-4f88-92bf-96f60248a9e9"
    },
    "Body": {
        "OccupancyGroupStatuses": [
            {
                "href": "/occupancygroup/11/status",
                "OccupancyGroup": {
                    "href": "/occupancygroup/11"
                },
                "OccupancyStatus": "Occupied"
            }
        ]
    }
};

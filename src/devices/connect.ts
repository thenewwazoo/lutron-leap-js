import { BridgeNetInfo, LeapClient } from '../index';

import { CasetaSmartBridge } from './SmartBridge';

type KnownBridges = 'SmartBridge';

export function getBridge(info: BridgeNetInfo, ca: string, key: string, cert: string): [LeapClient, any] {
    switch (info.systype) {
        case 'SmartBridge': {
            const client = new LeapClient(info.ipAddr, CasetaSmartBridge.LEAP_PORT, ca, key, cert);
            const bridge = new CasetaSmartBridge(info.bridgeid, client);
            return [client, bridge];
        }

        default: {
            throw new Error(`bridge ${info.bridgeid} has unknown systype ${info.systype}`);
        }
    }
}

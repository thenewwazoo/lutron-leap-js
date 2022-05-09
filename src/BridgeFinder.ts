import debug from 'debug';
import * as util from 'util';
import { EventEmitter } from 'events';

import ipaddress = require('ip-address');
import mdns = require('multicast-dns');
import dnspacket = require('dns-packet');
import { Protocol, MDNSServiceDiscovery, MDNSService } from 'tinkerhub-mdns';
import TypedEmitter from 'typed-emitter';

import { SmartBridge, LEAP_PORT } from './SmartBridge';
import { LeapClient } from './LeapClient';

const logDebug = debug('leap:protocol:discovery');

interface BridgeFinderEvents {
    discovered: (bridgeInfo: BridgeNetInfo) => void;
    failed: (error: Error) => void;
}

type HostAndPort = {
    host: string;
    port: number;
};

export type BridgeNetInfo = {
    bridgeid: string;
    ipAddr: string;
    systype?: string;
};

export class BridgeFinder extends (EventEmitter as new () => TypedEmitter<BridgeFinderEvents>) {
    private discovery?: MDNSServiceDiscovery;

    constructor() {
        super();
    }

    public beginSearching() {
        this.discovery = new MDNSServiceDiscovery({
            type: 'lutron',
            protocol: Protocol.TCP,
        });
        this.discovery.onAvailable((svc: MDNSService) => {
            this.handleDiscovery(svc)
                .then((bridgeInfo: BridgeNetInfo) => {
                    this.emit('discovered', bridgeInfo);
                })
                .catch((e) => {
                    logDebug('failed to handle discovery:', e);
                    this.emit('failed', e);
                });
        });
    }

    private async handleDiscovery(svc: MDNSService): Promise<BridgeNetInfo> {
        const systype = svc.data.get('systype');
        if (typeof systype === 'boolean') {
            throw new Error(`got boolean systype with value ${systype}`);
        }

        const ipaddr = this.extractIp(svc.addresses);
        logDebug('got useful ipaddr', ipaddr);

        if (!ipaddr) {
            logDebug('thing without useful address:', svc);
            throw new Error('could not get a useful address');
        }

        const bridgeID = await this.getBridgeID(svc.id);
        logDebug('extracted bridge ID:', bridgeID);

        return {
            bridgeid: bridgeID,
            ipAddr: ipaddr,
            systype,
        };
    }


    public destroy(): void {
        if (this.discovery) {
            this.discovery.destroy();
        }
    }

    private extractIp(haps: HostAndPort[]): string | undefined {
        for (const hostandport of haps) {
            logDebug('checking', hostandport);

            // prefer the ipv6 address, but only if it's reachable
            //
            // FIXME: this code is untested in real life, as my home network is
            // ipv4 only.

            const _ip = hostandport.host;
            try {
                const addr = new ipaddress.Address6(_ip);
                if (!addr.isLinkLocal() && !addr.isLoopback()) {
                    // TODO is this sufficient?
                    return _ip;
                    break;
                }
            } catch (e) {
                // try again, but as ipv4
                logDebug('was not ipv6:', e);
                try {
                    const _ = new ipaddress.Address4(_ip);
                    return _ip;
                } catch (e) {
                    // okay, apparently it's some garbage. log it and move on
                    logDebug('could not parse HostAndPort', hostandport, 'because', e);
                }
            }
        }

        return undefined;
    }

    private async getBridgeID(mdnsID: string): Promise<string> {
        const resolver = mdns({
            multicast: true,
            ttl: 1,
            // RFC6762 5.2 "MUST send its Multicast DNS queries from UDP source port 5353"
            port: 5353,
        });

        const _id = Math.floor(Math.random() * 65534) + 1;
        const tgt: string = await new Promise((resolve, reject) => {
            resolver.on('response', (packet: any) => {
                if (packet.id === _id) {
                    if (packet.answers.length !== 1) {
                        reject(new Error(`bad srv response: ${util.inspect(packet)}`));
                    }

                    resolve(packet.answers[0].data.target);
                }
            });

            resolver.query(
                {
                    // tslint:disable:no-bitwise
                    flags: dnspacket.RECURSION_DESIRED | dnspacket.AUTHENTIC_DATA,
                    id: _id,
                    questions: [
                        {
                            name: mdnsID,
                            type: 'SRV',
                            class: 'IN',
                        },
                    ],
                    additionals: [
                        {
                            name: '.',
                            type: 'OPT',
                            udpPayloadSize: 0x1000,
                        },
                    ],
                },
                {
                    port: 5353,
                    address: '224.0.0.251',
                },
            );

        });

        try {
            return tgt.match(/[Ll]utron-(?<id>\w+)\.local/)!.groups!.id.toUpperCase();
        } catch (e) {
            throw new Error(`could not get bridge serial number from ${tgt}: ${e}`);
        }
    }

}

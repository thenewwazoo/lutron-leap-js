import debug from 'debug';
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
    discovered: (bridge: SmartBridge) => void;
    failed: (error: Error) => void;
}

type HostAndPort = {
    host: string;
    port: number;
};

export type SecretStorage = {
    ca: string;
    key: string;
    cert: string;
};

export class BridgeFinder extends (EventEmitter as new () => TypedEmitter<BridgeFinderEvents>) {
    private discovery: MDNSServiceDiscovery;
    private secrets: Map<string, SecretStorage> = new Map();

    constructor(secrets: Map<string, SecretStorage>) {
        super();

        this.secrets = secrets;

        this.discovery = new MDNSServiceDiscovery({
            type: 'lutron',
            protocol: Protocol.TCP,
        });
        this.discovery.onAvailable((svc: MDNSService) => {
            this.handleDiscovery(svc)
                .then((bridge: SmartBridge) => {
                    this.emit('discovered', bridge);
                })
                .catch((e) => {
                    logDebug('failed to handle discovery:', e);
                    this.emit('failed', e);
                });
        });
    }

    public destroy(): void {
        this.discovery.destroy();
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

    private async extractBridgeFromIP(ipaddr: string): Promise<string> {
        if (this.secrets.size === 1) {
            // If there is only one hub then we can get the bridge value from the
            // secrets
            return this.secrets.entries().next().value[0];
        } else {
            // Otherwise query mdns for the hostname corresponding to the ip
            const hostname = await this.getHostnameFromIP(ipaddr);

            let bridgeID: string;
            try {
                bridgeID = hostname!.match(/[Ll]utron-(?<id>\w+)\.local/)!.groups!.id;
            } catch {
                if (hostname) {
                    bridgeID = ipaddr.replace('.', '_');
                } else {
                    throw new Error('could not extract bridge id from ip address');
                }
            }
            return bridgeID;
        }
    }

    private getHostnameFromIP(ip: string): Promise<string | undefined> {
        // n.b. this must not end with a dot. see https://github.com/mafintosh/dns-packet/issues/62
        const reversed = ip.split('.').reverse().join('.').concat('.in-addr.arpa');
        const _id = Math.floor(Math.random() * (65535 - 1 + 1)) + 1;

        let lookupResolve: (info: string) => void = (info: string) => {
            // this gets replaced
        };

        let lookupReject: (err: Error) => void = (err: Error) => {
            // this gets replaced
        };

        const lookupPromise = new Promise<string>((resolve, reject) => {
            lookupResolve = resolve;
            lookupReject = reject;
        });

        const resolver = mdns({
            multicast: true,
            ttl: 1,
            port: 0,
        });

        const timeout = setTimeout(lookupReject, 1000, `Did not get a hostname for ${ip} in time`);

        resolver.on('response', (packet: any) => {
            if (packet.id === _id) {
                clearTimeout(timeout);
                lookupResolve(packet.answers[0].data as string);
            }
        });

        // TODO this might not be the minimal argument possible
        // see https://github.com/mafintosh/multicast-dns/issues/13
        resolver.query(
            {
                // tslint:disable:no-bitwise
                flags: dnspacket.RECURSION_DESIRED | dnspacket.AUTHENTIC_DATA,
                id: _id,
                questions: [
                    {
                        name: reversed,
                        type: 'PTR',
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

        return lookupPromise;
    }

    private async handleDiscovery(svc: MDNSService): Promise<SmartBridge> {
        if (svc.data.get('systype') !== 'SmartBridge') {
            logDebug('invalid responder was', svc);
            throw new Error('invalid responder to discovery request');
        }

        const ipaddr = this.extractIp(svc.addresses);
        logDebug('got useful ipaddr', ipaddr);

        if (!ipaddr) {
            logDebug('thing without useful address:', svc);
            throw new Error('could not get a useful address');
        }

        const bridgeID = await this.extractBridgeFromIP(ipaddr);
        logDebug('extracted bridge ID:', bridgeID);

        if (this.secrets.has(bridgeID)) {
            const these = this.secrets.get(bridgeID)!;
            const client = new LeapClient(ipaddr, LEAP_PORT, these.ca, these.key, these.cert);
            await client.connect();
            return new SmartBridge(bridgeID, client);
        } else {
            throw new Error('no credentials for bridge ID ' + bridgeID);
        }
    }
}

import debug from 'debug';
import { EventEmitter } from 'events';

const ipaddress = require('ip-address');
const mdns = require('multicast-dns');
const { MDNSServiceDiscovery, MDNSService } = require('tinkerhub-mdns');
import TypedEmitter from 'typed-emitter';

import { SmartBridge, LEAP_PORT } from './SmartBridge';
import { LeapClient } from './LeapClient';

const logDebug = debug('leap:protocol:discovery');

interface BridgeFinderEvents {
    'discovered': (bridge: SmartBridge) => void;
}

type HostAndPort = {
    host: string,
    port: number,
}

export type SecretStorage = {
    ca: string,
    key: string,
    cert: string,
}

export class BridgeFinder extends (EventEmitter as new () => TypedEmitter<BridgeFinderEvents>) {
    private discovery: typeof MDNSServiceDiscovery;
    private secrets: Map<string, SecretStorage> = new Map();

    constructor(secrets: Map<string, SecretStorage>) {
        super();

        this.secrets = secrets;

        this.discovery = new MDNSServiceDiscovery({
            type: 'lutron',
            protocol: 'tcp',
        });
        this.discovery.onAvailable((svc: typeof MDNSService) => {
            this.handleDiscovery(svc).then((bridge: SmartBridge) => {
                this.emit("discovered", bridge);
            }).catch((e) => {
                logDebug("failed to handle discovery:", e);
            });
        });

    }

    public destroy(): void {
        this.discovery.destroy();
    }

    private extractIp(haps: Array<HostAndPort>): string | undefined {
        for (const hostandport of haps) {
            logDebug('checking', hostandport);

            // prefer the ipv6 address, but only if it's reachable
            //
            // FIXME: this code is untested in real life, as my home network is
            // ipv4 only.

            let _ip = hostandport.host;
            try {
                let addr = new ipaddress.Address6(_ip);
                if (!addr.isLinkLocal() && !addr.isLoopback()) { // TODO is this sufficient?
                    return _ip;
                    break;
                }
            } catch (e) {
                // try again, but as ipv4
                logDebug("was not ipv6:", e);
                try {
                    let _ = new ipaddress.Address4(_ip);
                    return _ip;
                } catch (e) {
                    // okay, apparently it's some garbage. log it and move on
                    logDebug('could not parse HostAndPort', hostandport, "because", e);
                }
            }
        }

        return undefined;
    }

    private getHostnameFromIP(ip: string): Promise<string | undefined> {
        // n.b. this must not end with a dot. see https://github.com/mafintosh/dns-packet/issues/62
        let reversed = ip.split('.').reverse().join(".").concat(".in-addr.arpa");
        let _id = Math.floor(Math.random() * (65535 - 1 + 1)) + 1;

        let lookupResolve: (info: string) => void = (info: string)  => {
            // this gets replaced
        }

        let lookupReject: (err: Error) => void = (err: Error) => {
            // this gets replaced
        }

        const lookupPromise = new Promise<string>((resolve, reject) => {
            lookupResolve = resolve;
            lookupReject = reject;
        });

        let resolver = mdns({
            multicast: true,
            ttl: 1,
            port: 0,
        });

        let timeout = setTimeout(lookupReject, 1000, "got tired of waiting");

        resolver.on('response', (packet: any) => {
            if (packet.id === _id) {
                clearTimeout(timeout);
                lookupResolve(<string>packet.answers[0].data);
            }
        });

        // TODO this might not be the minimal argument possible
        // see https://github.com/mafintosh/multicast-dns/issues/13
        resolver.query({
            flags: 1 << 8 | 1 << 5,
            id: _id,
            questions: [
                {
                    name: reversed,
                    type: 'PTR',
                    class: 'IN'
                },
            ],
            additionals: [
                {
                    name: '.',
                    type: 'OPT',
                    udpPayloadSize: 0x1000,
                },
            ],
        }, {
                      port: 5353,
                      address: "224.0.0.251",
        });

        return lookupPromise;
    }

    private async handleDiscovery(svc: typeof MDNSService): Promise<SmartBridge> {
        if (svc.data.get('systype') !== 'SmartBridge') {
            logDebug("invalid responder was", svc);
            throw new Error('invalid responder to discovery request');
        }

        let ipaddr = this.extractIp(svc.addresses);
        logDebug('got useful ipaddr', ipaddr);

        if (!ipaddr) {
            logDebug('thing without useful address:', svc);
            throw new Error('could not get a useful address');
        }

        let bridgeID;
        let hostname = await this.getHostnameFromIP(ipaddr);
        logDebug('got hostname from IP:', hostname);
        try {
            bridgeID = hostname!.match(/lutron-(?<id>\w+)\.local/)!.groups!.id; // may fail, don't care
        } catch {
            bridgeID = ipaddr.replace(".", "_");
        }
        logDebug('extracted bridge ID:', bridgeID);

        if (this.secrets.has(bridgeID)) {
            let these = this.secrets.get(bridgeID)!;
            let client = new LeapClient(ipaddr, LEAP_PORT, these.ca, these.key, these.cert);
            return new SmartBridge(bridgeID, client);
        } else {
            throw new Error("no credentials for bridge ID" + bridgeID);
        }
    }
}

import * as path from 'path';

type BridgeNetInfo = {
    bridgeid: string;
    ipAddr: string;
    systype?: string;
};

type BridgeFinderInstance = {
    on(event: 'discovered', handler: (info: BridgeNetInfo) => void): void;
    on(event: 'failed', handler: (error: Error) => void): void;
    beginSearching(): void;
    destroy(): void;
};

type BridgeFinderConstructor = new () => BridgeFinderInstance;

const DEFAULT_DURATION_MS = 15000;
const runtimeMs = parseDuration(process.argv[2]);
const BridgeFinder = loadBridgeFinder();
const finder = new BridgeFinder();
const discovered = new Map<string, BridgeNetInfo>();
let timer: NodeJS.Timeout | undefined;
let stopping = false;

console.log(`Searching for bridges for ${runtimeMs / 1000} seconds...`);

finder.on('discovered', (info) => {
    const isNewBridge = !discovered.has(info.bridgeid);
    discovered.set(info.bridgeid, info);

    const prefix = isNewBridge ? 'Discovered' : 'Updated';
    console.log(`[${new Date().toISOString()}] ${prefix}: ${formatBridge(info)}`);
});

finder.on('failed', (error) => {
    console.error('[BridgeFinder] discovery error:', error);
});

finder.beginSearching();

if (runtimeMs !== Number.POSITIVE_INFINITY) {
    timer = setTimeout(() => stop('timeout reached'), runtimeMs);
}

process.on('SIGINT', () => {
    console.log('\nStopping discovery (Ctrl+C pressed)...');
    stop('user request');
});

process.on('SIGTERM', () => {
    console.log('\nStopping discovery (SIGTERM)...');
    stop('signal');
});

function stop(reason: string) {
    if (stopping) {
        return;
    }

    stopping = true;
    if (timer) {
        clearTimeout(timer);
    }
    finder.destroy();

    console.log(`\nDiscovery stopped (${reason}). Found ${discovered.size} unique bridge(s).`);
    if (discovered.size === 0) {
        console.log('No bridges were discovered.');
    } else {
        for (const bridge of discovered.values()) {
            console.log(` - ${formatBridge(bridge)}`);
        }
    }
}

function parseDuration(raw?: string): number {
    if (!raw || raw === 'infinite') {
        return raw === 'infinite' ? Number.POSITIVE_INFINITY : DEFAULT_DURATION_MS;
    }

    const seconds = Number(raw);
    if (!Number.isFinite(seconds) || seconds <= 0) {
        console.warn(`Could not understand duration "${raw}", using default ${(DEFAULT_DURATION_MS / 1000).toFixed(0)} seconds.`);
        return DEFAULT_DURATION_MS;
    }

    return seconds * 1000;
}

function formatBridge(bridge: BridgeNetInfo): string {
    const sysTypeSuffix = bridge.systype ? `, systype=${bridge.systype}` : '';
    return `${bridge.bridgeid} @ ${bridge.ipAddr}${sysTypeSuffix}`;
}

function loadBridgeFinder(): BridgeFinderConstructor {
    const candidatePaths = [
        path.resolve(__dirname, '..', 'BridgeFinder'),
        path.resolve(__dirname, '..', 'dist', 'BridgeFinder'),
        path.resolve(__dirname, '..', 'src', 'BridgeFinder'),
    ];

    for (const candidate of candidatePaths) {
        try {
            const moduleExports = require(candidate);
            if (moduleExports && moduleExports.BridgeFinder) {
                return moduleExports.BridgeFinder as BridgeFinderConstructor;
            }
        } catch (error) {
            const err = error as NodeJS.ErrnoException;
            if (err.code !== 'MODULE_NOT_FOUND') {
                console.warn(`Failed to load BridgeFinder from ${candidate}:`, err);
            }
        }
    }

    throw new Error('Could not locate the BridgeFinder implementation. Build the project or run this script from the repo root.');
}

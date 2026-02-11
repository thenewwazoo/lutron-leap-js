import debug from 'debug';
import * as retry from 'async-retry';
import { EventEmitter } from 'events';

import { LeapClient } from './LeapClient';
import { Response, ResponseWithTag } from './Messages';
import {
    BodyType,
    ButtonDefinition,
    ButtonGroupDefinition,
    DeviceDefinition,
    ExceptionDetail,
    Href,
    MultipleDeviceDefinition,
    MultipleControlStationDefinition,
    OneButtonDefinition,
    OneButtonGroupDefinition,
    OneDeviceDefinition,
    OneZoneStatus,
    MultipleOccupancyGroupStatus,
} from './MessageBodyTypes';

import TypedEmitter from 'typed-emitter';
const logDebug = debug('leap:bridge');

export const LEAP_PORT = 8081;

// QSX Synthetic Button Generation
// Since QSX processors don't expose buttons via the LEAP API, we generate
// synthetic button definitions based on known device types.
// The button hrefs are computed from the button group ID.
const QSX_DEVICE_BUTTON_CONFIGS: Record<string, { count: number; startIndex: number }> = {
    // Palladiom keypads - typically 4-6 buttons
    PalladiomKeypad: { count: 6, startIndex: 0 },
    // SeeTouch tabletop keypads - typically have 10-17 buttons
    SeeTouchTabletopKeypad: { count: 17, startIndex: 0 },
    // Generic keypad fallback
    Keypad: { count: 6, startIndex: 0 },
    // SeeTouch wall keypads
    SeeTouchKeypad: { count: 6, startIndex: 0 },
    // Hybrid keypads
    HybridKeypad: { count: 6, startIndex: 0 },
};
const PING_INTERVAL_MS = 300000;
const PING_TIMEOUT_MS = 10000;
const CONNECT_MAX_RETRY = 20;

// Global semaphore to limit concurrent button probing across all devices
// This prevents overwhelming QSX processors during startup
const MAX_CONCURRENT_PROBES = 2;
let activeProbes = 0;
const probeQueue: Array<() => void> = [];

async function acquireProbeSlot(): Promise<void> {
    if (activeProbes < MAX_CONCURRENT_PROBES) {
        activeProbes++;
        return;
    }
    // Wait for a slot to become available
    return new Promise((resolve) => {
        probeQueue.push(() => {
            activeProbes++;
            resolve();
        });
    });
}

function releaseProbeSlot(): void {
    activeProbes--;
    const next = probeQueue.shift();
    if (next) {
        next();
    }
}

export interface BridgeInfo {
    firmwareRevision: string;
    manufacturer: string;
    model: string;
    name: string;
    serialNumber: string;
}

type SmartBridgeEvents = {
    unsolicited: (bridgeID: string, response: Response) => void;
    disconnected: () => void;
};

export class SmartBridge extends (EventEmitter as new () => TypedEmitter<SmartBridgeEvents>) {
    private pingLooper: ReturnType<typeof setInterval> | null = null;
    public bridgeReconfigInProgress: boolean;

    // Cache for device buttons - maps device href to all buttons on that device
    private deviceButtonCache: Map<string, ButtonDefinition[]> = new Map();

    // Track the highest button ID found per device for sequential probing
    private deviceHighestButtonId: Map<string, number> = new Map();

    // Whether QSX-specific global subscriptions have been set up
    private qsxSubscriptionsActive = false;

    constructor(public readonly bridgeID: string, public client: LeapClient) {
        super();
        logDebug('new bridge', bridgeID, 'being constructed');
        this.bridgeReconfigInProgress = false;
        client.on('unsolicited', this._handleUnsolicited.bind(this));
        client.on('disconnected', this._handleDisconnect.bind(this));
        this.startPingLoop();
    }
    public async reconfigureBridge(newClient: LeapClient) {
        this.bridgeReconfigInProgress = true;
        const oldClient = this.client;
        // close the old client's connections and remove its references to the bridge so it can be GC'd
        this.pingLooper = null;
        oldClient.drain();
        // replace the old client with the new
        this.client = newClient;
        this.client.on('unsolicited', this._handleUnsolicited.bind(this));
        this.client.on('disconnected', this._handleDisconnect.bind(this));
        // Make a new connection with the bridge, retry to make sure we get it
        // A freshly boot bridge will refuses the connection during several seconds
        await retry(
            async () => {
                logDebug('Connecting ...');
                await this.client.connect();
                logDebug('Connected');
            },
            { retries: CONNECT_MAX_RETRY, factor: 1 },
        );
        // Send disconnect signal for re-subscribing
        this.emit('disconnected');
        this.startPingLoop();

        // Re-subscribe to global button events if QSX was previously detected
        if (this.qsxSubscriptionsActive) {
            this.subscribeToAllButtons((r) => {
                this._handleUnsolicited(r);
            }).catch(() => {
                // Subscription setup may fail on some processors
            });
        }

        this.bridgeReconfigInProgress = false;
    }
    private startPingLoop(): void {
        this.pingLooper = setInterval((): void => {
            const pingPromise = this.client.request('ReadRequest', '/server/1/status/ping');
            const timeoutPromise = new Promise((resolve, reject): void => {
                setTimeout((): void => {
                    reject('Ping timeout');
                }, PING_TIMEOUT_MS);
            });

            Promise.race([pingPromise, timeoutPromise])
                .then((resp) => {
                    // if the ping succeeds, there's not really anything to do.
                    logDebug('Ping succeeded', resp);
                })
                .catch((e) => {
                    // if it fails, however, what do we do? the client's
                    // behavior is to attempt to re-open the connection if it's
                    // lost. that means calling `this.client.close()` might
                    // clobber in-flight requests made between the ping timing
                    // out and the attempt to close it. that's bad.
                    //
                    // I think the answer is: nothing. future attempts to use
                    // the client will block (and potentially eventually time
                    // out), and we don't ever want to prevent that happening
                    // unless specifically requested.
                    logDebug('Ping failed:', e);
                });
        }, PING_INTERVAL_MS);
    }

    public start(): void {
        // not much to do here, but it needs to exist if close exists.
        if (this.pingLooper === null) {
            logDebug('Bridge starting');
            this.startPingLoop();
        }
    }

    public close(): void {
        // much as with LeapClient.close, this method will not actually prevent
        // some caller from causing the client to reconnect. all this really
        // does is tell the client to close the socket, and kills the
        // keep-alive loop.
        logDebug('bridge id', this.bridgeID, 'closing');
        if (this.pingLooper !== null) {
            clearTimeout(this.pingLooper);
            this.pingLooper = null;
        }
        this.client.close();
    }

    public async ping(): Promise<Response> {
        return await this.client.request('ReadRequest', '/server/1/status/ping');
    }

    public async getHref(href: Href): Promise<BodyType> {
        logDebug(`client getting href ${href.href}`);
        const raw = await this.client.request('ReadRequest', href.href);
        return raw.Body!;
    }

    public async getBridgeInfo(): Promise<BridgeInfo> {
        logDebug('getting bridge information');
        const raw = await this.client.request('ReadRequest', '/device?where=IsThisDevice:true');
        if (
            (raw.Body! as MultipleDeviceDefinition).Devices &&
            (raw.Body! as MultipleDeviceDefinition).Devices.length > 0
        ) {
            const device = (raw.Body! as MultipleDeviceDefinition).Devices[0];
            return {
                firmwareRevision: device.FirmwareImage.Firmware.DisplayName,
                manufacturer: 'Lutron Electronics Co., Inc',
                model: device.ModelNumber,
                name: device.FullyQualifiedName?.join(' ') || device.Name,
                serialNumber: device.SerialNumber,
            };
        }
        // Fallback to old method for backwards compatibility
        const rawFallback = await this.client.request('ReadRequest', '/device/1');
        if ((rawFallback.Body! as OneDeviceDefinition).Device) {
            const device = (rawFallback.Body! as OneDeviceDefinition).Device;
            return {
                firmwareRevision: device.FirmwareImage.Firmware.DisplayName,
                manufacturer: 'Lutron Electronics Co., Inc',
                model: device.ModelNumber,
                name: device.FullyQualifiedName.join(' '),
                serialNumber: device.SerialNumber,
            };
        }
        throw new Error('Got bad response to bridge info request');
    }

    public async getDeviceInfo(): Promise<DeviceDefinition[]> {
        logDebug('getting info about all devices');

        // 1. Try standard /device list
        let standardDevices: DeviceDefinition[] = [];
        let gotNoContent = false;
        let deviceRequestFailed = false;
        try {
            const raw = await this.client.request('ReadRequest', '/device');

            // Check if we got a 204 NoContent response (indicates QSX processor)
            if (raw.Header.StatusCode?.code === 204) {
                logDebug('Got 204 NoContent, device list is empty or not supported on this processor');
                gotNoContent = true;
            } else if ((raw.Body! as MultipleDeviceDefinition).Devices) {
                standardDevices = (raw.Body! as MultipleDeviceDefinition).Devices;
            }
        } catch (e) {
            logDebug('Standard /device request failed or returned empty. Proceeding to QSX check.');
            deviceRequestFailed = true;
        }

        // 2. Map for Deduplication
        const deviceMap = new Map<string, DeviceDefinition>();
        for (const d of standardDevices) {
            deviceMap.set(d.href, d);
        }

        // 3. QSX Check
        // Only crawl for QSX devices when the /device endpoint returned 204 NoContent
        // (reliable QSX indicator) or failed entirely. A small Caseta installation
        // with few devices should NOT trigger this crawl.
        if (gotNoContent || (deviceRequestFailed && standardDevices.length === 0)) {
            logDebug('QSX processor detected, crawling areas for device discovery');
            const qsxDevices = await this.discoverQSXDevices();
            for (const d of qsxDevices) {
                deviceMap.set(d.href, d);
            }

            // Subscribe to global button/area events for QSX processors
            if (!this.qsxSubscriptionsActive) {
                this.qsxSubscriptionsActive = true;
                this.subscribeToAllButtons((r) => {
                    this._handleUnsolicited(r);
                }).catch(() => {
                    logDebug('Global button/area subscription failed');
                });
            }
        }

        return Array.from(deviceMap.values());
    }

    public async setBlindsTilt(device: DeviceDefinition, value: number): Promise<void> {
        const href = device.LocalZones[0].href + '/commandprocessor';
        logDebug('setting href', href, 'to value', value);
        this.client.request('CreateRequest', href, {
            Command: {
                CommandType: 'GoToTilt',
                TiltParameters: {
                    Tilt: Math.round(value),
                },
            },
        });
    }

    public async readBlindsTilt(device: DeviceDefinition): Promise<number> {
        const resp = await this.client.request('ReadRequest', device.LocalZones[0].href + '/status');
        const val = (resp.Body! as OneZoneStatus).ZoneStatus.Tilt;
        logDebug('read tilt for device', device.FullyQualifiedName.join(' '), 'at', val);
        return val;
    }

    /* A device has a list of ButtonGroup Hrefs. This method maps them to
     * (promises for) the actual ButtonGroup objects themselves.
     */
    public async getButtonGroupsFromDevice(
        device: DeviceDefinition,
    ): Promise<(ButtonGroupDefinition | ExceptionDetail)[]> {
        // If ButtonGroups exists and has entries, use them directly
        if (device.ButtonGroups && device.ButtonGroups.length > 0) {
            return Promise.all(
                device.ButtonGroups.map((bgHref: Href) =>
                    this.client.request('ReadRequest', bgHref.href).then((resp: Response) => {
                        switch (resp.CommuniqueType) {
                            case 'ExceptionResponse':
                                return resp.Body! as ExceptionDetail;
                            case 'ReadResponse':
                                return (resp.Body! as OneButtonGroupDefinition).ButtonGroup;
                            default:
                                throw new Error('Unexpected communique type');
                        }
                    }),
                ),
            );
        }

        // For QSX devices, ButtonGroups may not be in the device definition.
        // Try querying the device's buttongroup endpoint directly.
        logDebug(`No ButtonGroups on device ${device.href}, trying direct query...`);
        try {
            const bgResp = await this.client.request('ReadRequest', `${device.href}/buttongroup`);
            if (bgResp.Header.StatusCode?.code === 204) {
                logDebug(`Device ${device.href} has no button groups (204)`);
                return [];
            }
            // @ts-ignore - ButtonGroups response structure
            const buttonGroupRefs = bgResp.Body?.ButtonGroups || [];
            if (buttonGroupRefs.length > 0) {
                logDebug(`Found ${buttonGroupRefs.length} button group refs via direct query for ${device.href}`);
                // Fetch each button group individually to get full details including Buttons array
                return Promise.all(
                    buttonGroupRefs.map((bgRef: Href) =>
                        this.client.request('ReadRequest', bgRef.href).then((resp: Response) => {
                            switch (resp.CommuniqueType) {
                                case 'ExceptionResponse':
                                    return resp.Body! as ExceptionDetail;
                                case 'ReadResponse':
                                    return (resp.Body! as OneButtonGroupDefinition).ButtonGroup;
                                default:
                                    throw new Error('Unexpected communique type');
                            }
                        }),
                    ),
                );
            }
        } catch (e) {
            logDebug(`Direct buttongroup query failed for ${device.href}: ${e}`);
        }

        return [];
    }

    /**
     * Fetch button groups by their hrefs directly.
     * Used for merged devices (e.g., 2-gang keypads) where button groups
     * come from multiple physical devices.
     */
    public async getButtonGroupsByHrefs(hrefs: string[]): Promise<(ButtonGroupDefinition | ExceptionDetail)[]> {
        return Promise.all(
            hrefs.map((href: string) =>
                this.client.request('ReadRequest', href).then((resp: Response) => {
                    switch (resp.CommuniqueType) {
                        case 'ExceptionResponse':
                            return resp.Body! as ExceptionDetail;
                        case 'ReadResponse':
                            return (resp.Body! as OneButtonGroupDefinition).ButtonGroup;
                        default:
                            throw new Error('Unexpected communique type');
                    }
                }),
            ),
        );
    }

    /**
     * Fetch button groups from a device href (not a device object).
     * Used for merged devices where we only have the device hrefs.
     * This queries the device's /buttongroup endpoint directly.
     */
    public async getButtonGroupsFromDeviceHref(
        deviceHref: string,
    ): Promise<(ButtonGroupDefinition | ExceptionDetail)[]> {
        logDebug(`Fetching button groups from device href: ${deviceHref}`);
        try {
            const bgResp = await this.client.request('ReadRequest', `${deviceHref}/buttongroup`);
            if (bgResp.Header.StatusCode?.code === 204) {
                logDebug(`Device ${deviceHref} has no button groups (204)`);
                return [];
            }
            // @ts-ignore - ButtonGroups response structure
            const buttonGroupRefs = bgResp.Body?.ButtonGroups || [];
            if (buttonGroupRefs.length > 0) {
                logDebug(`Found ${buttonGroupRefs.length} button group refs for ${deviceHref}`);
                // Fetch each button group individually to get full details including Buttons array
                return Promise.all(
                    buttonGroupRefs.map((bgRef: Href) =>
                        this.client.request('ReadRequest', bgRef.href).then((resp: Response) => {
                            switch (resp.CommuniqueType) {
                                case 'ExceptionResponse':
                                    return resp.Body! as ExceptionDetail;
                                case 'ReadResponse':
                                    return (resp.Body! as OneButtonGroupDefinition).ButtonGroup;
                                default:
                                    throw new Error('Unexpected communique type');
                            }
                        }),
                    ),
                );
            }
        } catch (e) {
            logDebug(`Direct buttongroup query failed for ${deviceHref}: ${e}`);
        }

        return [];
    }

    /**
     * Fetch all buttons from a device and cache them.
     * This is used to discover buttons for QSX devices where probing near
     * buttongroup IDs fails because buttons are sequentially numbered across
     * the entire device, not near each buttongroup.
     */
    private async getAllButtonsFromDevice(deviceHref: string): Promise<ButtonDefinition[]> {
        // Check cache first
        if (this.deviceButtonCache.has(deviceHref)) {
            return this.deviceButtonCache.get(deviceHref)!;
        }

        const buttons: ButtonDefinition[] = [];

        try {
            // Try the device's /button endpoint
            const deviceButtonResp = await this.client.request('ReadRequest', `${deviceHref}/button`);
            if (deviceButtonResp.Header.StatusCode?.code === 200) {
                // @ts-ignore - Buttons response structure
                const buttonRefs = deviceButtonResp.Body?.Buttons || [];

                if (buttonRefs.length > 0) {
                    // Fetch each button in parallel
                    const buttonPromises = buttonRefs.map((btn: Href) =>
                        this.client
                            .request('ReadRequest', btn.href)
                            .then((resp) => {
                                if (resp.Header.StatusCode?.code === 200 && resp.Body) {
                                    return (resp.Body as OneButtonDefinition).Button;
                                }
                                return null;
                            })
                            .catch(() => null),
                    );
                    const fetchedButtons = await Promise.all(buttonPromises);
                    const validButtons = fetchedButtons.filter((b): b is ButtonDefinition => b !== null);
                    buttons.push(...validButtons);
                }
            }
        } catch (e) {
            logDebug(`Failed to fetch buttons from device ${deviceHref}: ${e}`);
        }

        // Cache the result (even if empty, to avoid repeated queries)
        this.deviceButtonCache.set(deviceHref, buttons);
        return buttons;
    }

    /**
     * Pre-populate the button cache for multiple device hrefs.
     * This is useful for merged devices (2-gang keypads) where buttons
     * might be spread across multiple physical devices.
     */
    public async prePopulateButtonCacheForDevices(deviceHrefs: string[]): Promise<void> {
        await Promise.all(deviceHrefs.map((href) => this.getAllButtonsFromDevice(href)));
    }

    /**
     * Search ALL cached buttons (across all devices) for buttons belonging to a buttongroup.
     * This is a fallback for merged devices where the buttongroup's Parent.href might point
     * to a different device than where the buttons actually are.
     */
    private searchAllCachedButtonsForGroup(buttonGroupHref: string): ButtonDefinition[] {
        const matchingButtons: ButtonDefinition[] = [];
        for (const [, buttons] of this.deviceButtonCache.entries()) {
            const groupButtons = buttons.filter((btn) => btn.Parent?.href === buttonGroupHref);
            if (groupButtons.length > 0) {
                matchingButtons.push(...groupButtons);
            }
        }
        return matchingButtons;
    }

    /* Similar to getButtonGroupsFromDevice, a ButtonGroup contains a list of
     * Button Hrefs. This maps them to (promises for) the actual Button
     * objects themselves.
     *
     * For QSX processors that don't expose buttons via the Buttons array,
     * we try to discover them via the button group's /button endpoint.
     */
    public async getButtonsFromGroup(bgroup: ButtonGroupDefinition): Promise<ButtonDefinition[]> {
        // If Buttons array exists and has entries, use it directly (Caseta/RA3 path)
        if (bgroup.Buttons && bgroup.Buttons.length > 0) {
            return Promise.all(
                bgroup.Buttons.map((button: Href) =>
                    this.client
                        .request('ReadRequest', button.href)
                        .then((resp: Response) => (resp.Body! as OneButtonDefinition).Button),
                ),
            );
        }

        // For QSX: Try to discover buttons via the button group's /button endpoint
        try {
            const buttonResp = await this.client.request('ReadRequest', `${bgroup.href}/button`);
            if (buttonResp.Header.StatusCode?.code === 200) {
                // @ts-ignore - Buttons response structure
                const buttonRefs = buttonResp.Body?.Buttons || [];
                if (buttonRefs.length > 0) {
                    return Promise.all(
                        buttonRefs.map((button: Href) =>
                            this.client
                                .request('ReadRequest', button.href)
                                .then((resp: Response) => (resp.Body! as OneButtonDefinition).Button),
                        ),
                    );
                }
            }
        } catch (e) {
            logDebug(`Button discovery via ${bgroup.href}/button failed: ${e}`);
        }

        // QSX Strategy: Try to get all buttons from the parent device and filter by buttongroup
        // This works when buttons are sequentially numbered across the device, not near each buttongroup ID
        // @ts-ignore
        const parentDeviceHref = bgroup.Parent?.href as string | undefined;

        // Keep track of buttons found from cache - we'll augment with probing results
        let cachedGroupButtons: ButtonDefinition[] = [];

        if (parentDeviceHref) {
            const allDeviceButtons = await this.getAllButtonsFromDevice(parentDeviceHref);

            if (allDeviceButtons.length > 0) {
                // Filter to buttons that belong to this buttongroup
                cachedGroupButtons = allDeviceButtons.filter((btn) => btn.Parent?.href === bgroup.href);

                // Update highest known button ID from cache
                if (cachedGroupButtons.length > 0) {
                    const maxButtonId = Math.max(
                        ...cachedGroupButtons.map((b) => parseInt(b.href.split('/').pop() || '0', 10)),
                    );
                    const currentHighest = this.deviceHighestButtonId.get(parentDeviceHref) || 0;
                    if (maxButtonId > currentHighest) {
                        this.deviceHighestButtonId.set(parentDeviceHref, maxButtonId);
                    }
                }
                // DON'T return here - continue to probe for additional buttons not in cache
            }
        }

        // Fallback for merged devices: Search ALL cached buttons across all devices
        // This handles cases where a buttongroup's Parent.href points to one device,
        // but the buttons are actually on another device in the merged set
        if (cachedGroupButtons.length === 0) {
            const allCachedButtons = this.searchAllCachedButtonsForGroup(bgroup.href);
            if (allCachedButtons.length > 0) {
                cachedGroupButtons = allCachedButtons;
            }
        }

        // Fallback: Try to query individual buttons near the button group ID
        // On QSX, button hrefs are often close to the button group ID
        const buttonGroupId = parseInt(bgroup.href.split('/').pop() || '0', 10);
        const parentDeviceId = parseInt((parentDeviceHref || '').split('/').pop() || '0', 10);

        // Check if we have a highest known button ID for this device
        // Buttons are often sequential across all buttongroups on a device
        const highestKnownButtonId = parentDeviceHref ? this.deviceHighestButtonId.get(parentDeviceHref) : undefined;

        // Acquire semaphore slot to limit concurrent probing across all devices
        await acquireProbeSlot();

        // Helper function to probe a range of button IDs
        const probeButtonRange = async (baseId: number, _label: string): Promise<ButtonDefinition[]> => {
            const BATCH_SIZE = 3;
            const BATCH_DELAY_MS = 200;
            const discoveredButtons: ButtonDefinition[] = [];
            let emptyBatchCount = 0;

            for (let batchStart = 1; batchStart <= 20; batchStart += BATCH_SIZE) {
                const batchPromises: Promise<ButtonDefinition | null>[] = [];

                for (let offset = batchStart; offset < batchStart + BATCH_SIZE && offset <= 20; offset++) {
                    const buttonHref = `/button/${baseId + offset}`;
                    batchPromises.push(
                        this.client
                            .request('ReadRequest', buttonHref)
                            .then((resp) => {
                                if (resp.Header.StatusCode?.code === 200 && resp.Body) {
                                    const button = (resp.Body as OneButtonDefinition).Button;
                                    if (button && button.Parent?.href === bgroup.href) {
                                        return button;
                                    }
                                }
                                return null;
                            })
                            .catch(() => null),
                    );
                }

                const batchResults = await Promise.all(batchPromises);
                const foundInBatch = batchResults.filter((b): b is ButtonDefinition => b !== null);
                discoveredButtons.push(...foundInBatch);

                if (foundInBatch.length === 0) {
                    emptyBatchCount++;
                    // Only stop early if we've found at least 3 buttons AND had 3 consecutive empty batches
                    if (discoveredButtons.length >= 3 && emptyBatchCount >= 3) {
                        break;
                    }
                } else {
                    emptyBatchCount = 0;
                }

                // Small delay between batches to let QSX recover
                if (batchStart + BATCH_SIZE <= 20) {
                    await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
                }
            }
            return discoveredButtons;
        };

        // Declared outside try block so we can merge with cached buttons after
        let discoveredButtons: ButtonDefinition[] = [];

        try {
            // Priority 1: If we have a highest known button ID for this device,
            // try probing from there first (buttons are often sequential across buttongroups)
            if (highestKnownButtonId && highestKnownButtonId > 0) {
                discoveredButtons = await probeButtonRange(highestKnownButtonId, 'sequential');
            }

            // Priority 2: Try probing near the button group ID
            if (discoveredButtons.length === 0) {
                discoveredButtons = await probeButtonRange(buttonGroupId, 'buttongroup');
            }

            // Priority 3: If no buttons found and device ID is different, try probing near device ID
            if (discoveredButtons.length === 0 && parentDeviceId > 0 && parentDeviceId !== buttonGroupId) {
                discoveredButtons = await probeButtonRange(parentDeviceId, 'device');
            }

            // Priority 4: Try querying the parent device's /button endpoint directly
            if (discoveredButtons.length === 0 && parentDeviceId > 0) {
                try {
                    const deviceButtonResp = await this.client.request(
                        'ReadRequest',
                        `/device/${parentDeviceId}/button`,
                    );
                    if (deviceButtonResp.Header.StatusCode?.code === 200) {
                        // @ts-ignore - Buttons response structure
                        const buttonRefs = deviceButtonResp.Body?.Buttons || [];
                        if (buttonRefs.length > 0) {
                            // Fetch each button and filter to those belonging to this button group
                            const buttonPromises = buttonRefs.map((btn: Href) =>
                                this.client
                                    .request('ReadRequest', btn.href)
                                    .then((resp) => {
                                        if (resp.Header.StatusCode?.code === 200 && resp.Body) {
                                            const button = (resp.Body as OneButtonDefinition).Button;
                                            // Only include buttons that belong to THIS button group
                                            if (button && button.Parent?.href === bgroup.href) {
                                                return button;
                                            }
                                        }
                                        return null;
                                    })
                                    .catch(() => null),
                            );
                            const buttons = await Promise.all(buttonPromises);
                            discoveredButtons = buttons.filter((b): b is ButtonDefinition => b !== null);
                        }
                    }
                } catch (e) {
                    logDebug(`Device /button endpoint failed for device ${parentDeviceId}: ${e}`);
                }
            }

            // Priority 5: If we found buttons, continue probing from the highest one found
            // Loop until we stop finding new buttons (handles devices with many sequential buttons)
            if (discoveredButtons.length > 0) {
                let lastMaxId = Math.max(...discoveredButtons.map((b) => parseInt(b.href.split('/').pop() || '0', 10)));
                let continuationRound = 0;
                const MAX_CONTINUATION_ROUNDS = 10; // Safety limit

                while (continuationRound < MAX_CONTINUATION_ROUNDS) {
                    continuationRound++;
                    const additionalButtons = await probeButtonRange(lastMaxId, `continuation-${continuationRound}`);

                    if (additionalButtons.length === 0) {
                        break;
                    }

                    // Merge with discovered buttons (deduplicate)
                    let newButtonsAdded = 0;
                    for (const btn of additionalButtons) {
                        if (!discoveredButtons.some((b) => b.href === btn.href)) {
                            discoveredButtons.push(btn);
                            newButtonsAdded++;
                        }
                    }

                    if (newButtonsAdded === 0) {
                        break;
                    }

                    // Update lastMaxId for next round
                    lastMaxId = Math.max(...discoveredButtons.map((b) => parseInt(b.href.split('/').pop() || '0', 10)));
                }
            }

            if (discoveredButtons.length > 0) {
                // Update the highest known button ID for this device
                if (parentDeviceHref) {
                    const maxButtonId = Math.max(
                        ...discoveredButtons.map((b) => parseInt(b.href.split('/').pop() || '0', 10)),
                    );
                    const currentHighest = this.deviceHighestButtonId.get(parentDeviceHref) || 0;
                    if (maxButtonId > currentHighest) {
                        this.deviceHighestButtonId.set(parentDeviceHref, maxButtonId);
                    }

                    // Also add to device button cache for future buttongroups
                    const cached = this.deviceButtonCache.get(parentDeviceHref) || [];
                    const newButtons = discoveredButtons.filter((b) => !cached.some((c) => c.href === b.href));
                    if (newButtons.length > 0) {
                        this.deviceButtonCache.set(parentDeviceHref, [...cached, ...newButtons]);
                    }
                }
            }
        } catch (e) {
            logDebug(`Probing failed for button group ${buttonGroupId}: ${e}`);
        }

        // Release semaphore before merging/returning (doesn't need throttling)
        releaseProbeSlot();

        // Merge cached buttons with probed buttons (deduplicate by href)
        const allButtons = [...cachedGroupButtons];
        for (const probedBtn of discoveredButtons) {
            if (!allButtons.some((b) => b.href === probedBtn.href)) {
                allButtons.push(probedBtn);
            }
        }

        if (allButtons.length > 0) {
            return allButtons;
        }

        // Last resort: Generate synthetic buttons
        // @ts-ignore
        const syntheticDeviceHref = bgroup.Parent?.href;
        if (syntheticDeviceHref) {
            // Fetch the parent device to get its type
            let deviceType = 'Unknown';
            try {
                const deviceResp = await this.client.request('ReadRequest', syntheticDeviceHref);
                deviceType = (deviceResp.Body as OneDeviceDefinition)?.Device?.DeviceType || 'Unknown';
            } catch (e) {
                logDebug(`Failed to fetch parent device: ${e}`);
            }

            // Check if this device type supports synthetic button generation
            let buttonConfig = QSX_DEVICE_BUTTON_CONFIGS[deviceType];

            // If no exact match, check for partial matches (e.g., "SomeNewKeypad" contains "Keypad")
            if (!buttonConfig) {
                for (const [key, config] of Object.entries(QSX_DEVICE_BUTTON_CONFIGS)) {
                    if (deviceType.includes(key)) {
                        buttonConfig = config;
                        break;
                    }
                }
            }

            if (buttonConfig) {
                // Generate synthetic buttons
                const syntheticButtons: ButtonDefinition[] = [];

                for (let i = 0; i < buttonConfig.count; i++) {
                    const buttonNumber = buttonConfig.startIndex + i;
                    const buttonId = buttonGroupId * 100 + buttonNumber;
                    const buttonHref = `/button/${buttonId}`;

                    syntheticButtons.push({
                        href: buttonHref,
                        ButtonNumber: buttonNumber,
                        Name: `Button ${buttonNumber + 1}`,
                        // @ts-ignore - Adding parent reference for debugging
                        Parent: { href: bgroup.href },
                        // @ts-ignore - Mark as synthetic for debugging
                        _synthetic: true,
                    } as unknown as ButtonDefinition);
                }

                return syntheticButtons;
            }
        }

        return [];
    }

    public subscribeToButton(button: ButtonDefinition, cb: (r: Response) => void) {
        // @ts-ignore - Check if this is a synthetic button
        if (button._synthetic) {
            // QSX processors don't support button/buttongroup status subscriptions.
            // Button presses on QSX keypads trigger scene changes instead of button events.
            // We handle this via area status subscriptions in subscribeToAllButtons().
            return;
        }
        this.client.subscribe(button.href + '/status/event', cb);
    }

    /**
     * Subscribe to all button events globally.
     * This may be required on QSX to enable button event streaming.
     * We try multiple endpoints since QSX may use different event paths.
     *
     * On QSX, keypads don't emit button events - they trigger scene changes.
     * We subscribe to /area/status to capture these scene activations.
     */
    public async subscribeToAllButtons(cb: (r: Response) => void): Promise<void> {
        // Try multiple endpoints - QSX may deliver button events differently
        const endpoints = [
            '/button/status', // Works on Caseta/RA3
            '/area/status', // QSX keypads trigger scene changes on areas
        ];

        for (const endpoint of endpoints) {
            try {
                await this.client.subscribe(endpoint, (r) => {
                    cb(r);
                });
            } catch (e) {
                logDebug(`Global ${endpoint} subscription failed: ${e}`);
            }
        }
    }

    /* Because we can't subscribe to individual occupancysensors, we have to
     * subscribe to everything and handle routing elsewhere. As such, this will
     * call `cb` every time any sensor changes.
     */
    public async subscribeToOccupancy(cb: (r: Response) => void): Promise<MultipleOccupancyGroupStatus> {
        this.client.subscribe('/occupancygroup/status', cb).catch((e) => {
            logDebug('ignoring failed subscription because response is not tagged');
        });

        return this.client
            .request('ReadRequest', '/occupancygroup/status')
            .then((resp: Response) => resp.Body! as MultipleOccupancyGroupStatus);
    }

    private _handleUnsolicited(response: Response) {
        logDebug('bridge', this.bridgeID, 'got unsolicited message:');
        logDebug(response);
        this.emit('unsolicited', this.bridgeID, response);
    }

    private _handleDisconnect(): void {
        // nothing to do here
        logDebug('bridge id', this.bridgeID, 'disconnected.');
        this.emit('disconnected');
    }

    /**
     * Fetch a single button by href (for dynamic discovery).
     * Used when a button press event arrives for an unknown button.
     */
    public async getButton(buttonHref: string): Promise<ButtonDefinition | null> {
        try {
            const resp = await this.client.request('ReadRequest', buttonHref);
            if (resp.Header.StatusCode?.code === 200 && resp.Body) {
                return (resp.Body as OneButtonDefinition).Button;
            }
        } catch (e) {
            logDebug(`Failed to fetch button ${buttonHref}: ${e}`);
        }
        return null;
    }

    /**
     * Export all cached buttons for persistence.
     * Returns a copy of the device button cache.
     */
    public getAllCachedButtons(): Map<string, ButtonDefinition[]> {
        return new Map(this.deviceButtonCache);
    }

    /**
     * Import a previously discovered button into the cache.
     * Used to restore persisted buttons on startup.
     */
    public addDiscoveredButton(deviceHref: string, button: ButtonDefinition): void {
        const existing = this.deviceButtonCache.get(deviceHref) || [];
        if (!existing.some((b) => b.href === button.href)) {
            existing.push(button);
            this.deviceButtonCache.set(deviceHref, existing);
            logDebug(`Added discovered button ${button.href} to cache for device ${deviceHref}`);
        }
    }

    /**
     * QSX Helper: Crawl areas to find devices hidden from the main /device endpoint.
     */
    private async discoverQSXDevices(): Promise<DeviceDefinition[]> {
        logDebug('QSX detected: Starting Area crawl for device discovery...');
        const foundDevices: DeviceDefinition[] = [];

        // 1. Get all Areas
        let areas: any[] = [];
        try {
            // @ts-ignore
            const areaRaw = await this.client.request('ReadRequest', '/area');
            // @ts-ignore
            areas = areaRaw.Body.Areas || [];
        } catch (e) {
            return [];
        }

        // 2. Scan each area
        const stationPromises = areas.map(async (area) => {
            if (!area.href) return;

            try {
                const url = `${area.href}/associatedcontrolstation`;
                // @ts-ignore
                const response = await this.client.request('ReadRequest', url);
                const body = response.Body as MultipleControlStationDefinition;

                if (body && body.ControlStations) {
                    for (const station of body.ControlStations) {
                        if (station.AssociatedGangedDevices) {
                            for (const gang of station.AssociatedGangedDevices) {
                                // @ts-ignore
                                const device = gang.Device || gang;

                                if (device && device.href) {
                                    // Build the name from area/station FIRST (before fetching full details)
                                    const areaName = (area as any).Name || 'Area';
                                    const stationName = station.Name || 'Station';
                                    const partialDeviceName = device.Name || stationName;
                                    const builtName = [areaName, partialDeviceName];

                                    // For devices that might have zones/buttons, fetch full details
                                    // to avoid overwriting important fields
                                    const needsFullDetails =
                                        device.DeviceType === 'PlugInDimmer' ||
                                        device.DeviceType === 'WallDimmer' ||
                                        device.DeviceType === 'PlugInSwitch' ||
                                        device.DeviceType === 'PalladiomKeypad' ||
                                        device.DeviceType === 'SeeTouchTabletopKeypad' ||
                                        device.DeviceType?.includes('Keypad') ||
                                        device.DeviceType?.includes('Pico');

                                    let fullDevice = device;
                                    if (needsFullDetails) {
                                        try {
                                            const resp = await this.client.request('ReadRequest', device.href);
                                            if (resp.Body && (resp.Body as OneDeviceDefinition).Device) {
                                                fullDevice = (resp.Body as OneDeviceDefinition).Device;
                                            }
                                        } catch (e) {
                                            // If fetch fails, continue with partial device
                                            logDebug(`Failed to fetch full device details for ${device.href}`);
                                        }
                                    }

                                    // Always use the area-based name we built, not the generic device name
                                    fullDevice.FullyQualifiedName = builtName;

                                    if (!fullDevice.SerialNumber) {
                                        fullDevice.SerialNumber = fullDevice.href.split('/').pop() || '000000';
                                    }
                                    if (!fullDevice.ModelNumber) {
                                        fullDevice.ModelNumber = fullDevice.DeviceType || 'QSX Device';
                                    }

                                    // We force these to be arrays if they are missing
                                    if (!fullDevice.ButtonGroups) fullDevice.ButtonGroups = [];
                                    if (!fullDevice.LocalZones) fullDevice.LocalZones = [];
                                    if (!fullDevice.OccupancySensors) fullDevice.OccupancySensors = [];
                                    if (!fullDevice.LinkNodes) fullDevice.LinkNodes = [];
                                    if (!fullDevice.DeviceRules) fullDevice.DeviceRules = [];

                                    if (!fullDevice.AssociatedArea) {
                                        fullDevice.AssociatedArea = { href: area.href };
                                    }

                                    foundDevices.push(fullDevice as DeviceDefinition);
                                }
                            }
                        }
                    }
                }
            } catch (e) {
                // Ignore errors
            }
        });

        await Promise.all(stationPromises);
        return foundDevices;
    }
}

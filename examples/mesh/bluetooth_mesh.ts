/**
 * Bluetooth/WiFi Mesh Network
 *
 * Enables peer-to-peer communication when internet is unavailable.
 * Based on Briar's architecture for offline-first messaging.
 */

import { RuVector } from 'ruvector-wasm';

// Message types for mesh protocol
enum MeshMessageType {
    DISCOVERY = 'discovery',
    HANDSHAKE = 'handshake',
    SYNC_REQUEST = 'sync_request',
    SYNC_RESPONSE = 'sync_response',
    MESSAGE = 'message',
    ACK = 'ack'
}

interface MeshPeer {
    id: string;
    publicKey: Uint8Array;
    lastSeen: number;
    connectionType: 'bluetooth' | 'wifi_direct' | 'wifi_lan';
    rssi?: number;  // Signal strength for Bluetooth
    address: string;
}

interface MeshMessage {
    id: string;
    type: MeshMessageType;
    sender: string;
    recipient: string;  // Can be '*' for broadcast
    payload: Uint8Array;
    timestamp: number;
    ttl: number;  // Hops remaining
    signature: Uint8Array;
}

interface SyncState {
    peerId: string;
    merkleRoot: string;
    lastSyncTime: number;
}

/**
 * Bluetooth Mesh Transport
 *
 * Uses Web Bluetooth API for browser, or native Bluetooth for mobile
 */
class BluetoothMeshTransport {
    private device: BluetoothDevice | null = null;
    private characteristic: BluetoothRemoteGATTCharacteristic | null = null;

    // RuVector mesh service UUID
    private readonly SERVICE_UUID = 'f8b0a812-0000-1000-8000-00805f9b34fb';
    private readonly CHAR_UUID = 'f8b0a812-0001-1000-8000-00805f9b34fb';

    /**
     * Scan for nearby mesh peers
     */
    async scanForPeers(): Promise<MeshPeer[]> {
        if (!navigator.bluetooth) {
            console.warn('[Mesh] Web Bluetooth not available');
            return [];
        }

        const peers: MeshPeer[] = [];

        try {
            // Request device with our service
            const device = await navigator.bluetooth.requestDevice({
                filters: [{ services: [this.SERVICE_UUID] }],
                optionalServices: [this.SERVICE_UUID]
            });

            if (device.gatt) {
                peers.push({
                    id: device.id,
                    publicKey: new Uint8Array(32), // Would be exchanged in handshake
                    lastSeen: Date.now(),
                    connectionType: 'bluetooth',
                    address: device.id
                });
            }
        } catch (error) {
            console.error('[Mesh] Bluetooth scan error:', error);
        }

        return peers;
    }

    /**
     * Connect to a peer
     */
    async connect(peer: MeshPeer): Promise<boolean> {
        try {
            // In Web Bluetooth, we need the device reference
            // This is simplified - real implementation would cache devices
            this.device = await navigator.bluetooth.requestDevice({
                filters: [{ services: [this.SERVICE_UUID] }]
            });

            if (!this.device.gatt) return false;

            const server = await this.device.gatt.connect();
            const service = await server.getPrimaryService(this.SERVICE_UUID);
            this.characteristic = await service.getCharacteristic(this.CHAR_UUID);

            // Enable notifications for incoming messages
            await this.characteristic.startNotifications();
            this.characteristic.addEventListener('characteristicvaluechanged', this.onMessage.bind(this));

            console.log(`[Mesh] Connected to ${peer.id}`);
            return true;
        } catch (error) {
            console.error('[Mesh] Connection error:', error);
            return false;
        }
    }

    /**
     * Send message to connected peer
     */
    async send(message: MeshMessage): Promise<boolean> {
        if (!this.characteristic) {
            console.error('[Mesh] Not connected');
            return false;
        }

        try {
            const encoded = this.encodeMessage(message);

            // Bluetooth has MTU limits, chunk if needed
            const MTU = 512;
            for (let i = 0; i < encoded.length; i += MTU) {
                const chunk = encoded.slice(i, Math.min(i + MTU, encoded.length));
                await this.characteristic.writeValue(chunk);
            }

            return true;
        } catch (error) {
            console.error('[Mesh] Send error:', error);
            return false;
        }
    }

    private onMessage(event: Event): void {
        const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
        if (!value) return;

        const bytes = new Uint8Array(value.buffer);
        const message = this.decodeMessage(bytes);

        // Emit event for mesh network to handle
        window.dispatchEvent(new CustomEvent('mesh-message', { detail: message }));
    }

    private encodeMessage(message: MeshMessage): Uint8Array {
        // Simple encoding - use protobuf or CBOR in production
        return new TextEncoder().encode(JSON.stringify(message));
    }

    private decodeMessage(bytes: Uint8Array): MeshMessage {
        return JSON.parse(new TextDecoder().decode(bytes));
    }

    disconnect(): void {
        if (this.device?.gatt?.connected) {
            this.device.gatt.disconnect();
        }
        this.device = null;
        this.characteristic = null;
    }
}

/**
 * WiFi Direct Transport
 *
 * Uses WiFi Direct for higher bandwidth mesh connections
 */
class WiFiDirectTransport {
    private socket: WebSocket | null = null;

    /**
     * Create WiFi Direct group (become group owner)
     */
    async createGroup(): Promise<string> {
        // This requires native implementation
        // React Native: use react-native-wifi-p2p
        // Cordova: use cordova-plugin-wifi-direct

        // Return group name/SSID
        return 'DIRECT-rv-' + Math.random().toString(36).substring(7);
    }

    /**
     * Discover WiFi Direct groups
     */
    async discoverGroups(): Promise<MeshPeer[]> {
        // Native implementation required
        // Returns list of discovered P2P groups
        return [];
    }

    /**
     * Connect to WiFi Direct peer
     */
    async connect(peer: MeshPeer): Promise<boolean> {
        // After WiFi Direct connection, use WebSocket for data
        try {
            this.socket = new WebSocket(`ws://${peer.address}:8765`);

            return new Promise((resolve) => {
                if (!this.socket) return resolve(false);

                this.socket.onopen = () => {
                    console.log(`[Mesh] WiFi Direct connected to ${peer.id}`);
                    resolve(true);
                };

                this.socket.onerror = () => resolve(false);

                this.socket.onmessage = (event) => {
                    const message = JSON.parse(event.data);
                    window.dispatchEvent(new CustomEvent('mesh-message', { detail: message }));
                };
            });
        } catch (error) {
            console.error('[Mesh] WiFi Direct error:', error);
            return false;
        }
    }

    async send(message: MeshMessage): Promise<boolean> {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            return false;
        }

        this.socket.send(JSON.stringify(message));
        return true;
    }

    disconnect(): void {
        this.socket?.close();
        this.socket = null;
    }
}

/**
 * Main Mesh Network Manager
 *
 * Coordinates discovery, connection, and message routing
 */
class MeshNetwork {
    private ruvector: RuVector;
    private bluetooth: BluetoothMeshTransport;
    private wifiDirect: WiFiDirectTransport;

    private peers: Map<string, MeshPeer> = new Map();
    private syncStates: Map<string, SyncState> = new Map();
    private messageQueue: MeshMessage[] = [];

    private myId: string;
    private myPublicKey: Uint8Array;

    constructor(ruvector: RuVector, myId: string, publicKey: Uint8Array) {
        this.ruvector = ruvector;
        this.myId = myId;
        this.myPublicKey = publicKey;

        this.bluetooth = new BluetoothMeshTransport();
        this.wifiDirect = new WiFiDirectTransport();

        // Listen for incoming messages
        window.addEventListener('mesh-message', (event: CustomEvent<MeshMessage>) => {
            this.handleMessage(event.detail);
        });
    }

    /**
     * Start mesh networking
     */
    async start(): Promise<void> {
        console.log('[Mesh] Starting mesh network...');

        // Start periodic discovery
        this.startDiscoveryLoop();

        // Start sync loop
        this.startSyncLoop();

        // Process message queue
        this.startQueueProcessor();
    }

    /**
     * Periodic peer discovery
     */
    private startDiscoveryLoop(): void {
        setInterval(async () => {
            console.log('[Mesh] Scanning for peers...');

            // Scan both transports
            const [btPeers, wifiPeers] = await Promise.all([
                this.bluetooth.scanForPeers(),
                this.wifiDirect.discoverGroups()
            ]);

            // Update peer list
            [...btPeers, ...wifiPeers].forEach(peer => {
                const existing = this.peers.get(peer.id);
                if (existing) {
                    existing.lastSeen = Date.now();
                    existing.rssi = peer.rssi;
                } else {
                    this.peers.set(peer.id, peer);
                    console.log(`[Mesh] Discovered new peer: ${peer.id}`);
                }
            });

            // Remove stale peers (not seen in 5 minutes)
            const staleThreshold = Date.now() - 5 * 60 * 1000;
            for (const [id, peer] of this.peers) {
                if (peer.lastSeen < staleThreshold) {
                    this.peers.delete(id);
                    console.log(`[Mesh] Removed stale peer: ${id}`);
                }
            }
        }, 30000); // Every 30 seconds
    }

    /**
     * Sync with peers using Merkle trees
     */
    private startSyncLoop(): void {
        setInterval(async () => {
            for (const [peerId, peer] of this.peers) {
                await this.syncWithPeer(peer);
            }
        }, 60000); // Every minute
    }

    /**
     * Sync messages with a specific peer
     */
    private async syncWithPeer(peer: MeshPeer): Promise<void> {
        console.log(`[Mesh] Syncing with ${peer.id}...`);

        // Get our Merkle root for messages
        const myMerkleRoot = await this.computeMerkleRoot();

        // Send sync request
        const syncRequest: MeshMessage = {
            id: crypto.randomUUID(),
            type: MeshMessageType.SYNC_REQUEST,
            sender: this.myId,
            recipient: peer.id,
            payload: new TextEncoder().encode(JSON.stringify({
                merkleRoot: myMerkleRoot,
                lastSync: this.syncStates.get(peer.id)?.lastSyncTime || 0
            })),
            timestamp: Date.now(),
            ttl: 1,
            signature: new Uint8Array(64) // Would be actual signature
        };

        // Connect and send
        const connected = peer.connectionType === 'bluetooth'
            ? await this.bluetooth.connect(peer)
            : await this.wifiDirect.connect(peer);

        if (connected) {
            const transport = peer.connectionType === 'bluetooth'
                ? this.bluetooth
                : this.wifiDirect;

            await transport.send(syncRequest);
        }
    }

    /**
     * Compute Merkle root of all messages
     */
    private async computeMerkleRoot(): Promise<string> {
        // Query all message IDs from RuVector
        const result = await this.ruvector.query(
            'MATCH (m:Message) RETURN m.id ORDER BY m.id'
        );

        if (!result || result.length === 0) {
            return '0'.repeat(64);
        }

        // Build Merkle tree
        let hashes = await Promise.all(
            result.map(async (r: any) => {
                const hash = await crypto.subtle.digest(
                    'SHA-256',
                    new TextEncoder().encode(r.id)
                );
                return new Uint8Array(hash);
            })
        );

        while (hashes.length > 1) {
            const newHashes: Uint8Array[] = [];
            for (let i = 0; i < hashes.length; i += 2) {
                const left = hashes[i];
                const right = hashes[i + 1] || hashes[i];
                const combined = new Uint8Array(left.length + right.length);
                combined.set(left);
                combined.set(right, left.length);
                const hash = await crypto.subtle.digest('SHA-256', combined);
                newHashes.push(new Uint8Array(hash));
            }
            hashes = newHashes;
        }

        return Buffer.from(hashes[0]).toString('hex');
    }

    /**
     * Handle incoming mesh message
     */
    private async handleMessage(message: MeshMessage): Promise<void> {
        console.log(`[Mesh] Received ${message.type} from ${message.sender}`);

        switch (message.type) {
            case MeshMessageType.DISCOVERY:
                await this.handleDiscovery(message);
                break;
            case MeshMessageType.SYNC_REQUEST:
                await this.handleSyncRequest(message);
                break;
            case MeshMessageType.SYNC_RESPONSE:
                await this.handleSyncResponse(message);
                break;
            case MeshMessageType.MESSAGE:
                await this.handleUserMessage(message);
                break;
        }

        // Forward if TTL > 0 and not for us
        if (message.ttl > 0 && message.recipient !== this.myId && message.recipient !== '*') {
            message.ttl--;
            this.messageQueue.push(message);
        }
    }

    private async handleDiscovery(message: MeshMessage): Promise<void> {
        // Peer announced themselves
        const peerInfo = JSON.parse(new TextDecoder().decode(message.payload));
        console.log(`[Mesh] Peer discovered: ${peerInfo.id}`);
    }

    private async handleSyncRequest(message: MeshMessage): Promise<void> {
        const request = JSON.parse(new TextDecoder().decode(message.payload));

        // Compare Merkle roots
        const myRoot = await this.computeMerkleRoot();

        if (myRoot !== request.merkleRoot) {
            // Roots differ, need to exchange messages
            // Get messages since last sync
            const messages = await this.ruvector.query(
                'MATCH (m:Message) WHERE m.timestamp > $since RETURN m',
                { since: request.lastSync }
            );

            // Send sync response with missing messages
            const response: MeshMessage = {
                id: crypto.randomUUID(),
                type: MeshMessageType.SYNC_RESPONSE,
                sender: this.myId,
                recipient: message.sender,
                payload: new TextEncoder().encode(JSON.stringify({
                    merkleRoot: myRoot,
                    messages
                })),
                timestamp: Date.now(),
                ttl: 1,
                signature: new Uint8Array(64)
            };

            this.messageQueue.push(response);
        }
    }

    private async handleSyncResponse(message: MeshMessage): Promise<void> {
        const response = JSON.parse(new TextDecoder().decode(message.payload));

        // Store received messages
        for (const msg of response.messages) {
            await this.ruvector.insert(msg);
        }

        // Update sync state
        this.syncStates.set(message.sender, {
            peerId: message.sender,
            merkleRoot: response.merkleRoot,
            lastSyncTime: Date.now()
        });

        console.log(`[Mesh] Synced ${response.messages.length} messages from ${message.sender}`);
    }

    private async handleUserMessage(message: MeshMessage): Promise<void> {
        // Store in RuVector
        await this.ruvector.insert({
            id: message.id,
            type: 'Message',
            sender: message.sender,
            content: message.payload,
            timestamp: message.timestamp,
            receivedVia: 'mesh'
        });

        // Notify UI
        window.dispatchEvent(new CustomEvent('new-message', {
            detail: { id: message.id, sender: message.sender }
        }));
    }

    /**
     * Process queued messages
     */
    private startQueueProcessor(): void {
        setInterval(async () => {
            if (this.messageQueue.length === 0) return;

            const message = this.messageQueue.shift()!;

            // Find best peer to forward to
            const targetPeer = this.findBestPeer(message.recipient);
            if (!targetPeer) {
                // No peer available, re-queue
                this.messageQueue.push(message);
                return;
            }

            // Send via appropriate transport
            const transport = targetPeer.connectionType === 'bluetooth'
                ? this.bluetooth
                : this.wifiDirect;

            await transport.connect(targetPeer);
            await transport.send(message);
        }, 1000);
    }

    private findBestPeer(recipientId: string): MeshPeer | null {
        // If we know the recipient, send directly
        if (this.peers.has(recipientId)) {
            return this.peers.get(recipientId)!;
        }

        // Otherwise, send to peer with best signal
        let bestPeer: MeshPeer | null = null;
        let bestRssi = -Infinity;

        for (const peer of this.peers.values()) {
            if (peer.rssi && peer.rssi > bestRssi) {
                bestRssi = peer.rssi;
                bestPeer = peer;
            }
        }

        return bestPeer;
    }

    /**
     * Send a message through the mesh
     */
    async sendMessage(recipientId: string, content: Uint8Array): Promise<string> {
        const message: MeshMessage = {
            id: crypto.randomUUID(),
            type: MeshMessageType.MESSAGE,
            sender: this.myId,
            recipient: recipientId,
            payload: content,
            timestamp: Date.now(),
            ttl: 5,  // Max 5 hops
            signature: new Uint8Array(64) // Would be actual signature
        };

        // Store locally
        await this.ruvector.insert({
            id: message.id,
            type: 'Message',
            sender: this.myId,
            recipient: recipientId,
            content,
            timestamp: message.timestamp,
            status: 'pending'
        });

        // Queue for delivery
        this.messageQueue.push(message);

        return message.id;
    }

    /**
     * Broadcast message to all peers
     */
    async broadcast(content: Uint8Array): Promise<string> {
        return this.sendMessage('*', content);
    }

    /**
     * Get network status
     */
    getStatus(): {
        peerCount: number;
        queueLength: number;
        peers: MeshPeer[];
    } {
        return {
            peerCount: this.peers.size,
            queueLength: this.messageQueue.length,
            peers: Array.from(this.peers.values())
        };
    }
}

// Usage Example
async function demonstrateMeshNetwork() {
    console.log('=== Bluetooth/WiFi Mesh Network Demo ===\n');

    const ruvector = new (class {
        async query(_q: string, _p?: any) { return []; }
        async insert(_d: any) { return 'ok'; }
    })() as any;

    const mesh = new MeshNetwork(
        ruvector,
        'user-' + Math.random().toString(36).substring(7),
        new Uint8Array(32)
    );

    // Start the mesh
    await mesh.start();

    console.log('Mesh network started');
    console.log('Status:', mesh.getStatus());

    // Send a message (would work when peers are nearby)
    const msgId = await mesh.sendMessage(
        'recipient-id',
        new TextEncoder().encode('Hello from offline mesh!')
    );
    console.log('Message queued:', msgId);
}

export { MeshNetwork, MeshMessage, MeshPeer, MeshMessageType };

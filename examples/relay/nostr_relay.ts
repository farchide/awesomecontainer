/**
 * Nostr-Compatible Relay with RuVector Backend
 *
 * Implements NIP-01 (Basic Protocol) and common NIPs for a
 * censorship-resistant event relay.
 *
 * Uses RuVector for:
 * - Vector similarity search (semantic search)
 * - Graph queries (social graph traversal)
 * - Distributed replication
 */

import { RuVector } from 'ruvector-wasm';
import { WebSocketServer, WebSocket } from 'ws';

// Nostr Event Structure (NIP-01)
interface NostrEvent {
    id: string;           // 32-byte hex, SHA256 of serialized event
    pubkey: string;       // 32-byte hex, public key
    created_at: number;   // Unix timestamp
    kind: number;         // Event type
    tags: string[][];     // Array of tag arrays
    content: string;      // Arbitrary string
    sig: string;          // 64-byte hex, Schnorr signature
}

// Nostr Event Kinds
enum EventKind {
    METADATA = 0,           // User profile
    TEXT_NOTE = 1,          // Short text note
    RECOMMEND_RELAY = 2,    // Relay recommendation
    CONTACTS = 3,           // Contact list
    ENCRYPTED_DM = 4,       // Encrypted direct message
    DELETE = 5,             // Delete event
    REPOST = 6,             // Repost/share
    REACTION = 7,           // Reaction (like)
    CHANNEL_CREATE = 40,    // Create channel
    CHANNEL_MESSAGE = 42,   // Channel message
    RELAY_LIST = 10002,     // Relay list (NIP-65)
}

// Filter for subscriptions (NIP-01)
interface NostrFilter {
    ids?: string[];
    authors?: string[];
    kinds?: number[];
    '#e'?: string[];        // Event references
    '#p'?: string[];        // Pubkey references
    since?: number;
    until?: number;
    limit?: number;
    search?: string;        // NIP-50: Full-text search
}

// Client message types
type ClientMessage =
    | ['EVENT', NostrEvent]
    | ['REQ', string, ...NostrFilter[]]
    | ['CLOSE', string]
    | ['AUTH', NostrEvent];  // NIP-42

// Relay message types
type RelayMessage =
    | ['EVENT', string, NostrEvent]
    | ['OK', string, boolean, string]
    | ['EOSE', string]
    | ['NOTICE', string]
    | ['AUTH', string];      // NIP-42 challenge

interface Subscription {
    id: string;
    filters: NostrFilter[];
    client: WebSocket;
}

/**
 * Nostr Relay with RuVector Backend
 */
class NostrRelay {
    private ruvector: RuVector;
    private wss: WebSocketServer;
    private subscriptions: Map<string, Subscription> = new Map();
    private clients: Set<WebSocket> = new Set();

    constructor(ruvector: RuVector, port: number = 8080) {
        this.ruvector = ruvector;
        this.wss = new WebSocketServer({ port });

        this.setupWebSocketServer();
        console.log(`[Relay] Nostr relay listening on port ${port}`);
    }

    private setupWebSocketServer(): void {
        this.wss.on('connection', (ws: WebSocket) => {
            console.log('[Relay] Client connected');
            this.clients.add(ws);

            ws.on('message', (data: Buffer) => {
                this.handleMessage(ws, data.toString());
            });

            ws.on('close', () => {
                console.log('[Relay] Client disconnected');
                this.clients.delete(ws);
                this.removeClientSubscriptions(ws);
            });

            ws.on('error', (error) => {
                console.error('[Relay] WebSocket error:', error);
            });
        });
    }

    private async handleMessage(ws: WebSocket, data: string): Promise<void> {
        try {
            const message: ClientMessage = JSON.parse(data);

            switch (message[0]) {
                case 'EVENT':
                    await this.handleEvent(ws, message[1]);
                    break;
                case 'REQ':
                    await this.handleReq(ws, message[1], message.slice(2) as NostrFilter[]);
                    break;
                case 'CLOSE':
                    this.handleClose(message[1]);
                    break;
                case 'AUTH':
                    await this.handleAuth(ws, message[1]);
                    break;
                default:
                    this.send(ws, ['NOTICE', 'Unknown message type']);
            }
        } catch (error) {
            console.error('[Relay] Message parse error:', error);
            this.send(ws, ['NOTICE', 'Invalid message format']);
        }
    }

    /**
     * Handle EVENT message - store new event
     */
    private async handleEvent(ws: WebSocket, event: NostrEvent): Promise<void> {
        // Validate event
        if (!this.validateEvent(event)) {
            this.send(ws, ['OK', event.id, false, 'invalid: event validation failed']);
            return;
        }

        // Check for deletion (NIP-09)
        if (event.kind === EventKind.DELETE) {
            await this.handleDeletion(event);
            this.send(ws, ['OK', event.id, true, '']);
            return;
        }

        // Generate embedding for semantic search (NIP-50 support)
        const embedding = await this.generateEmbedding(event.content);

        // Store in RuVector with graph relationships
        try {
            await this.ruvector.insert({
                id: event.id,
                type: 'NostrEvent',
                pubkey: event.pubkey,
                kind: event.kind,
                created_at: event.created_at,
                content: event.content,
                tags: event.tags,
                sig: event.sig,
                embedding,  // Vector for similarity search
            });

            // Create graph edges for tags
            await this.createGraphEdges(event);

            // Notify subscribers
            await this.notifySubscribers(event);

            this.send(ws, ['OK', event.id, true, '']);
            console.log(`[Relay] Stored event ${event.id.substring(0, 8)}... kind=${event.kind}`);

        } catch (error) {
            console.error('[Relay] Store error:', error);
            this.send(ws, ['OK', event.id, false, 'error: failed to store event']);
        }
    }

    /**
     * Handle REQ message - subscribe to events
     */
    private async handleReq(
        ws: WebSocket,
        subscriptionId: string,
        filters: NostrFilter[]
    ): Promise<void> {
        // Store subscription
        this.subscriptions.set(subscriptionId, {
            id: subscriptionId,
            filters,
            client: ws
        });

        // Query existing events
        for (const filter of filters) {
            const events = await this.queryEvents(filter);

            for (const event of events) {
                this.send(ws, ['EVENT', subscriptionId, event]);
            }
        }

        // Send End of Stored Events
        this.send(ws, ['EOSE', subscriptionId]);
    }

    /**
     * Query events matching filter
     */
    private async queryEvents(filter: NostrFilter): Promise<NostrEvent[]> {
        let cypher = 'MATCH (e:NostrEvent) WHERE 1=1';
        const params: Record<string, any> = {};

        // Build Cypher query from filter
        if (filter.ids?.length) {
            cypher += ' AND e.id IN $ids';
            params.ids = filter.ids;
        }

        if (filter.authors?.length) {
            cypher += ' AND e.pubkey IN $authors';
            params.authors = filter.authors;
        }

        if (filter.kinds?.length) {
            cypher += ' AND e.kind IN $kinds';
            params.kinds = filter.kinds;
        }

        if (filter.since) {
            cypher += ' AND e.created_at >= $since';
            params.since = filter.since;
        }

        if (filter.until) {
            cypher += ' AND e.created_at <= $until';
            params.until = filter.until;
        }

        // Handle tag filters
        if (filter['#e']?.length) {
            cypher += ' AND ANY(tag IN e.tags WHERE tag[0] = "e" AND tag[1] IN $eTags)';
            params.eTags = filter['#e'];
        }

        if (filter['#p']?.length) {
            cypher += ' AND ANY(tag IN e.tags WHERE tag[0] = "p" AND tag[1] IN $pTags)';
            params.pTags = filter['#p'];
        }

        // Semantic search (NIP-50)
        if (filter.search) {
            const searchEmbedding = await this.generateEmbedding(filter.search);
            cypher += ' AND e.embedding <-> $searchEmbedding < 0.5';
            params.searchEmbedding = searchEmbedding;
        }

        cypher += ' RETURN e ORDER BY e.created_at DESC';

        if (filter.limit) {
            cypher += ` LIMIT ${filter.limit}`;
        }

        const results = await this.ruvector.query(cypher, params);
        return results.map(r => this.resultToEvent(r));
    }

    /**
     * Handle CLOSE message - unsubscribe
     */
    private handleClose(subscriptionId: string): void {
        this.subscriptions.delete(subscriptionId);
        console.log(`[Relay] Closed subscription ${subscriptionId}`);
    }

    /**
     * Handle AUTH message (NIP-42)
     */
    private async handleAuth(ws: WebSocket, event: NostrEvent): Promise<void> {
        if (!this.validateEvent(event)) {
            this.send(ws, ['OK', event.id, false, 'auth-required: invalid auth event']);
            return;
        }

        // Verify auth event has correct tags
        const relayTag = event.tags.find(t => t[0] === 'relay');
        const challengeTag = event.tags.find(t => t[0] === 'challenge');

        if (!relayTag || !challengeTag) {
            this.send(ws, ['OK', event.id, false, 'auth-required: missing tags']);
            return;
        }

        // Mark client as authenticated
        (ws as any).authenticatedPubkey = event.pubkey;
        this.send(ws, ['OK', event.id, true, '']);
        console.log(`[Relay] Client authenticated: ${event.pubkey.substring(0, 8)}...`);
    }

    /**
     * Handle event deletion (NIP-09)
     */
    private async handleDeletion(event: NostrEvent): Promise<void> {
        // Get event IDs to delete from tags
        const eventIds = event.tags
            .filter(t => t[0] === 'e')
            .map(t => t[1]);

        // Delete only if same author
        await this.ruvector.query(
            `MATCH (e:NostrEvent)
             WHERE e.id IN $ids AND e.pubkey = $pubkey
             DELETE e`,
            { ids: eventIds, pubkey: event.pubkey }
        );

        console.log(`[Relay] Deleted ${eventIds.length} events by ${event.pubkey.substring(0, 8)}...`);
    }

    /**
     * Create graph edges from event tags
     */
    private async createGraphEdges(event: NostrEvent): Promise<void> {
        for (const tag of event.tags) {
            if (tag[0] === 'e' && tag[1]) {
                // Reference to another event
                await this.ruvector.query(
                    `MATCH (a:NostrEvent {id: $fromId}), (b:NostrEvent {id: $toId})
                     MERGE (a)-[:REFERENCES]->(b)`,
                    { fromId: event.id, toId: tag[1] }
                );
            } else if (tag[0] === 'p' && tag[1]) {
                // Reference to a pubkey
                await this.ruvector.query(
                    `MATCH (e:NostrEvent {id: $eventId})
                     MERGE (p:Pubkey {key: $pubkey})
                     MERGE (e)-[:MENTIONS]->(p)`,
                    { eventId: event.id, pubkey: tag[1] }
                );
            }
        }
    }

    /**
     * Notify all subscribers about new event
     */
    private async notifySubscribers(event: NostrEvent): Promise<void> {
        for (const [subId, subscription] of this.subscriptions) {
            // Check if event matches any filter
            const matches = subscription.filters.some(filter =>
                this.eventMatchesFilter(event, filter)
            );

            if (matches && subscription.client.readyState === WebSocket.OPEN) {
                this.send(subscription.client, ['EVENT', subId, event]);
            }
        }
    }

    /**
     * Check if event matches filter
     */
    private eventMatchesFilter(event: NostrEvent, filter: NostrFilter): boolean {
        if (filter.ids?.length && !filter.ids.includes(event.id)) return false;
        if (filter.authors?.length && !filter.authors.includes(event.pubkey)) return false;
        if (filter.kinds?.length && !filter.kinds.includes(event.kind)) return false;
        if (filter.since && event.created_at < filter.since) return false;
        if (filter.until && event.created_at > filter.until) return false;

        // Check tag filters
        if (filter['#e']?.length) {
            const eventTags = event.tags.filter(t => t[0] === 'e').map(t => t[1]);
            if (!filter['#e'].some(id => eventTags.includes(id))) return false;
        }

        if (filter['#p']?.length) {
            const pubkeyTags = event.tags.filter(t => t[0] === 'p').map(t => t[1]);
            if (!filter['#p'].some(pk => pubkeyTags.includes(pk))) return false;
        }

        return true;
    }

    /**
     * Validate Nostr event
     */
    private validateEvent(event: NostrEvent): boolean {
        // Verify event ID
        const serialized = JSON.stringify([
            0,
            event.pubkey,
            event.created_at,
            event.kind,
            event.tags,
            event.content
        ]);

        // Would compute SHA256 and verify signature in production
        // Using schnorr signature verification

        return (
            typeof event.id === 'string' && event.id.length === 64 &&
            typeof event.pubkey === 'string' && event.pubkey.length === 64 &&
            typeof event.created_at === 'number' &&
            typeof event.kind === 'number' &&
            Array.isArray(event.tags) &&
            typeof event.content === 'string' &&
            typeof event.sig === 'string' && event.sig.length === 128
        );
    }

    /**
     * Generate embedding for semantic search
     */
    private async generateEmbedding(text: string): Promise<number[]> {
        // Use RuVector's built-in embeddings or external model
        // This is a placeholder - use actual embedding model

        // Simple TF-IDF style embedding for demo
        const words = text.toLowerCase().split(/\s+/);
        const embedding = new Array(768).fill(0);

        for (let i = 0; i < words.length; i++) {
            const hash = this.simpleHash(words[i]);
            embedding[hash % 768] += 1;
        }

        // Normalize
        const norm = Math.sqrt(embedding.reduce((a, b) => a + b * b, 0));
        return embedding.map(v => v / (norm || 1));
    }

    private simpleHash(str: string): number {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash |= 0;
        }
        return Math.abs(hash);
    }

    /**
     * Convert RuVector result to NostrEvent
     */
    private resultToEvent(result: any): NostrEvent {
        return {
            id: result.id,
            pubkey: result.pubkey,
            created_at: result.created_at,
            kind: result.kind,
            tags: result.tags,
            content: result.content,
            sig: result.sig
        };
    }

    /**
     * Remove subscriptions for disconnected client
     */
    private removeClientSubscriptions(ws: WebSocket): void {
        for (const [subId, subscription] of this.subscriptions) {
            if (subscription.client === ws) {
                this.subscriptions.delete(subId);
            }
        }
    }

    /**
     * Send message to client
     */
    private send(ws: WebSocket, message: RelayMessage): void {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(message));
        }
    }

    /**
     * Broadcast to all clients
     */
    broadcast(message: RelayMessage): void {
        for (const client of this.clients) {
            this.send(client, message);
        }
    }

    /**
     * Get relay stats
     */
    getStats(): {
        clients: number;
        subscriptions: number;
        events: Promise<number>;
    } {
        return {
            clients: this.clients.size,
            subscriptions: this.subscriptions.size,
            events: this.ruvector.query('MATCH (e:NostrEvent) RETURN count(e)').then(r => r[0]?.count || 0)
        };
    }

    /**
     * Close the relay
     */
    close(): void {
        this.wss.close();
        console.log('[Relay] Relay closed');
    }
}

/**
 * Federation with other relays
 */
class RelayFederation {
    private relay: NostrRelay;
    private peerRelays: Map<string, WebSocket> = new Map();

    constructor(relay: NostrRelay) {
        this.relay = relay;
    }

    /**
     * Connect to peer relay
     */
    async connectToPeer(url: string): Promise<void> {
        const ws = new WebSocket(url);

        ws.on('open', () => {
            console.log(`[Federation] Connected to ${url}`);
            this.peerRelays.set(url, ws);

            // Subscribe to all events from peer
            ws.send(JSON.stringify(['REQ', 'federation', {}]));
        });

        ws.on('message', (data: Buffer) => {
            const message = JSON.parse(data.toString());
            if (message[0] === 'EVENT') {
                // Forward event to our relay
                // The relay will deduplicate based on event ID
            }
        });

        ws.on('close', () => {
            this.peerRelays.delete(url);
            // Reconnect after delay
            setTimeout(() => this.connectToPeer(url), 30000);
        });
    }

    /**
     * Broadcast event to all peers
     */
    broadcastToPeers(event: NostrEvent): void {
        const message = JSON.stringify(['EVENT', event]);
        for (const ws of this.peerRelays.values()) {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(message);
            }
        }
    }
}

// Usage Example
async function startRelay() {
    console.log('=== Nostr Relay with RuVector Backend ===\n');

    // Initialize RuVector
    const ruvector = new (class {
        async query(q: string, p?: any) { console.log('Query:', q); return []; }
        async insert(d: any) { console.log('Insert:', d.id); return 'ok'; }
    })() as any;

    // Create relay
    const relay = new NostrRelay(ruvector, 8080);

    // Setup federation (optional)
    const federation = new RelayFederation(relay);
    // federation.connectToPeer('wss://relay.damus.io');
    // federation.connectToPeer('wss://nos.lol');

    console.log('Relay is running. Connect with a Nostr client.\n');

    // Display stats periodically
    setInterval(async () => {
        const stats = relay.getStats();
        console.log(`Stats: ${stats.clients} clients, ${stats.subscriptions} subscriptions`);
    }, 60000);
}

export { NostrRelay, RelayFederation, NostrEvent, NostrFilter, EventKind };

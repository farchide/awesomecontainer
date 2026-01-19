/**
 * Adaptive Transport Selector
 *
 * Automatically selects the best available transport method based on
 * network conditions and censorship detection.
 */

import { RuVector } from 'ruvector-wasm';

// Transport priority (lower = higher priority when available)
enum TransportType {
    WEBRTC_DIRECT = 1,      // Fastest, but easily blocked
    WEBSOCKET = 2,          // Standard web, some blocking
    WEBTRANSPORT = 3,       // HTTP/3, newer
    TOR = 4,                // Anonymized, slower
    I2P = 5,                // Maximum anonymity
    DOMAIN_FRONTING = 6,    // CDN-based evasion
    MIXNET = 7,             // Traffic analysis resistant
    MESH_BLUETOOTH = 8,     // Offline fallback
    MESH_WIFI = 9,          // Local network fallback
    DTN = 10                // Store-and-forward
}

interface TransportConfig {
    type: TransportType;
    enabled: boolean;
    priority: number;
    healthCheckUrl?: string;
    bootstrapPeers?: string[];
}

interface ProbeResult {
    transport: TransportType;
    latency: number;
    available: boolean;
    censored: boolean;
}

class AdaptiveTransportSelector {
    private transports: Map<TransportType, TransportConfig> = new Map();
    private currentTransport: TransportType | null = null;
    private probeResults: ProbeResult[] = [];
    private ruvector: RuVector;

    constructor(ruvector: RuVector) {
        this.ruvector = ruvector;
        this.initializeTransports();
    }

    private initializeTransports(): void {
        // Default transport configurations
        this.transports.set(TransportType.WEBRTC_DIRECT, {
            type: TransportType.WEBRTC_DIRECT,
            enabled: true,
            priority: 1,
            healthCheckUrl: undefined, // P2P, no central check
            bootstrapPeers: [
                '/dns4/bootstrap1.ruvector.net/tcp/4001/p2p/...',
                '/dns4/bootstrap2.ruvector.net/tcp/4001/p2p/...'
            ]
        });

        this.transports.set(TransportType.TOR, {
            type: TransportType.TOR,
            enabled: true,
            priority: 4,
            healthCheckUrl: 'http://check.torproject.org/',
            bootstrapPeers: [] // Uses Tor directory
        });

        this.transports.set(TransportType.DOMAIN_FRONTING, {
            type: TransportType.DOMAIN_FRONTING,
            enabled: true,
            priority: 6,
            healthCheckUrl: 'https://cdn.cloudflare.com', // Decoy
            bootstrapPeers: ['wss://hidden-relay.example.com']
        });

        this.transports.set(TransportType.MESH_BLUETOOTH, {
            type: TransportType.MESH_BLUETOOTH,
            enabled: true,
            priority: 8
        });
    }

    /**
     * Probe all transports and select the best available one
     */
    async selectBestTransport(): Promise<TransportType> {
        console.log('[Transport] Starting transport probes...');

        // Probe all enabled transports in parallel
        const probePromises = Array.from(this.transports.entries())
            .filter(([_, config]) => config.enabled)
            .map(([type, config]) => this.probeTransport(type, config));

        this.probeResults = await Promise.all(probePromises);

        // Filter available, non-censored transports
        const availableTransports = this.probeResults
            .filter(r => r.available && !r.censored)
            .sort((a, b) => {
                // Sort by priority, then latency
                const priorityA = this.transports.get(a.transport)?.priority || 99;
                const priorityB = this.transports.get(b.transport)?.priority || 99;
                if (priorityA !== priorityB) return priorityA - priorityB;
                return a.latency - b.latency;
            });

        if (availableTransports.length === 0) {
            console.warn('[Transport] No transports available, falling back to DTN');
            return TransportType.DTN;
        }

        this.currentTransport = availableTransports[0].transport;
        console.log(`[Transport] Selected: ${TransportType[this.currentTransport]}`);
        return this.currentTransport;
    }

    /**
     * Probe a specific transport for availability
     */
    private async probeTransport(
        type: TransportType,
        config: TransportConfig
    ): Promise<ProbeResult> {
        const startTime = Date.now();

        try {
            switch (type) {
                case TransportType.WEBRTC_DIRECT:
                    return await this.probeWebRTC(config);
                case TransportType.TOR:
                    return await this.probeTor(config);
                case TransportType.DOMAIN_FRONTING:
                    return await this.probeDomainFronting(config);
                case TransportType.MESH_BLUETOOTH:
                    return await this.probeBluetooth(config);
                default:
                    return {
                        transport: type,
                        latency: Date.now() - startTime,
                        available: false,
                        censored: false
                    };
            }
        } catch (error) {
            return {
                transport: type,
                latency: -1,
                available: false,
                censored: this.isCensorshipError(error)
            };
        }
    }

    /**
     * Probe WebRTC connectivity
     */
    private async probeWebRTC(config: TransportConfig): Promise<ProbeResult> {
        const startTime = Date.now();

        // Check if WebRTC is available
        if (typeof RTCPeerConnection === 'undefined') {
            return { transport: TransportType.WEBRTC_DIRECT, latency: -1, available: false, censored: false };
        }

        // Try to establish a peer connection through STUN
        const pc = new RTCPeerConnection({
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun.cloudflare.com:3478' }
            ]
        });

        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                pc.close();
                resolve({
                    transport: TransportType.WEBRTC_DIRECT,
                    latency: -1,
                    available: false,
                    censored: true // STUN blocked = likely censored
                });
            }, 5000);

            pc.onicecandidate = (event) => {
                if (event.candidate) {
                    clearTimeout(timeout);
                    pc.close();
                    resolve({
                        transport: TransportType.WEBRTC_DIRECT,
                        latency: Date.now() - startTime,
                        available: true,
                        censored: false
                    });
                }
            };

            // Create dummy data channel to trigger ICE
            pc.createDataChannel('probe');
            pc.createOffer().then(offer => pc.setLocalDescription(offer));
        });
    }

    /**
     * Probe Tor connectivity
     */
    private async probeTor(config: TransportConfig): Promise<ProbeResult> {
        const startTime = Date.now();

        try {
            // Check if Tor SOCKS proxy is available
            const response = await fetch(config.healthCheckUrl!, {
                method: 'HEAD',
                signal: AbortSignal.timeout(10000)
            });

            // check.torproject.org returns specific response when through Tor
            const isTor = response.headers.get('X-Check-Tor') === 'true';

            return {
                transport: TransportType.TOR,
                latency: Date.now() - startTime,
                available: isTor,
                censored: !isTor && response.status !== 200
            };
        } catch {
            return {
                transport: TransportType.TOR,
                latency: -1,
                available: false,
                censored: true
            };
        }
    }

    /**
     * Probe domain fronting through CDN
     */
    private async probeDomainFronting(config: TransportConfig): Promise<ProbeResult> {
        const startTime = Date.now();

        try {
            // Request to CDN with different Host header
            const response = await fetch(config.healthCheckUrl!, {
                method: 'HEAD',
                headers: {
                    // The hidden service receives this
                    'X-Forwarded-Host': 'api.ruvector.net'
                },
                signal: AbortSignal.timeout(5000)
            });

            return {
                transport: TransportType.DOMAIN_FRONTING,
                latency: Date.now() - startTime,
                available: response.ok,
                censored: false
            };
        } catch {
            return {
                transport: TransportType.DOMAIN_FRONTING,
                latency: -1,
                available: false,
                censored: true
            };
        }
    }

    /**
     * Probe Bluetooth mesh availability
     */
    private async probeBluetooth(config: TransportConfig): Promise<ProbeResult> {
        const startTime = Date.now();

        // Check Web Bluetooth API availability
        if (!navigator.bluetooth) {
            return {
                transport: TransportType.MESH_BLUETOOTH,
                latency: -1,
                available: false,
                censored: false // Not censored, just unavailable
            };
        }

        try {
            // Check if we can access Bluetooth
            const available = await navigator.bluetooth.getAvailability();
            return {
                transport: TransportType.MESH_BLUETOOTH,
                latency: Date.now() - startTime,
                available,
                censored: false
            };
        } catch {
            return {
                transport: TransportType.MESH_BLUETOOTH,
                latency: -1,
                available: false,
                censored: false
            };
        }
    }

    /**
     * Detect if an error indicates censorship
     */
    private isCensorshipError(error: unknown): boolean {
        if (error instanceof Error) {
            const msg = error.message.toLowerCase();
            return (
                msg.includes('connection reset') ||
                msg.includes('connection refused') ||
                msg.includes('timeout') ||
                msg.includes('network error') ||
                msg.includes('blocked')
            );
        }
        return false;
    }

    /**
     * Monitor current transport and switch if needed
     */
    async monitorAndAdapt(): Promise<void> {
        setInterval(async () => {
            if (!this.currentTransport) return;

            const config = this.transports.get(this.currentTransport);
            if (!config) return;

            const result = await this.probeTransport(this.currentTransport, config);

            if (!result.available || result.censored) {
                console.warn(`[Transport] ${TransportType[this.currentTransport]} became unavailable`);
                await this.selectBestTransport();
            }
        }, 30000); // Check every 30 seconds
    }

    /**
     * Get current transport status
     */
    getStatus(): { current: string; available: string[] } {
        return {
            current: this.currentTransport ? TransportType[this.currentTransport] : 'none',
            available: this.probeResults
                .filter(r => r.available && !r.censored)
                .map(r => TransportType[r.transport])
        };
    }
}

// Usage Example
async function main() {
    const ruvector = new RuVector({ storage: 'indexeddb' });
    const transport = new AdaptiveTransportSelector(ruvector);

    // Select best transport
    const selected = await transport.selectBestTransport();
    console.log('Selected transport:', TransportType[selected]);

    // Start monitoring
    transport.monitorAndAdapt();

    // Check status
    console.log('Status:', transport.getStatus());
}

export { AdaptiveTransportSelector, TransportType };

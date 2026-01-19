# RuVector Censorship-Resistant Network Examples

This directory contains implementation examples for building a censorship-resistant social media network using RuVector as the core data layer.

## Directory Structure

```
examples/
├── transport/
│   └── adaptive_transport.ts    # Multi-transport selection and failover
├── crypto/
│   └── quantum_resistant.ts     # Post-quantum cryptography (ML-KEM, ML-DSA)
├── identity/
│   └── decentralized_identity.ts # Self-sovereign identity (DIDs, VCs)
├── mesh/
│   └── bluetooth_mesh.ts        # Bluetooth/WiFi offline mesh networking
├── relay/
│   └── nostr_relay.ts           # Nostr-compatible relay with RuVector backend
└── README.md                    # This file
```

## Examples Overview

### 1. Adaptive Transport (`transport/adaptive_transport.ts`)

Automatically selects the best available transport based on network conditions and censorship detection.

**Features:**
- WebRTC direct peer-to-peer
- Tor/I2P onion routing
- Domain fronting via CDNs
- Snowflake volunteer proxies
- Automatic failover

**Usage:**
```typescript
import { AdaptiveTransportSelector } from './transport/adaptive_transport';

const transport = new AdaptiveTransportSelector(ruvector);
const selected = await transport.selectBestTransport();
transport.monitorAndAdapt(); // Continuous monitoring
```

### 2. Quantum-Resistant Crypto (`crypto/quantum_resistant.ts`)

Hybrid classical + post-quantum cryptography to protect against future quantum computers.

**Algorithms:**
- Key Exchange: X25519 + ML-KEM-768 (CRYSTALS-Kyber)
- Signatures: Ed25519 + ML-DSA-65 (CRYSTALS-Dilithium)
- Symmetric: AES-256-GCM, ChaCha20-Poly1305
- Hashing: SHA3-256, BLAKE3

**Usage:**
```typescript
import { HybridCrypto, SecurePostProtocol } from './crypto/quantum_resistant';

// Generate quantum-resistant keys
const signingKeys = await HybridCrypto.generateSigningKeyPair();
const encryptionKeys = await HybridCrypto.generateEncryptionKeyPair();

// Create secure post
const post = await SecurePostProtocol.createPost(
    { signing: signingKeys, encryption: encryptionKeys },
    recipientKeys,
    "Secret message"
);
```

### 3. Decentralized Identity (`identity/decentralized_identity.ts`)

Self-sovereign identity using DIDs (Decentralized Identifiers) and Verifiable Credentials.

**Features:**
- No central authority
- did:key, did:web, did:ruvector methods
- Web of Trust for reputation
- Sybil resistance via Proof of Work
- Verifiable Credentials

**Usage:**
```typescript
import { IdentityManager } from './identity/decentralized_identity';

const identity = new IdentityManager(ruvector);
const { did, document } = await identity.createIdentity();

// Build trust network
await identity.trustIdentity(otherDID, 0.8, 'identity');

// Issue credentials
const credential = await identity.issueCredential(
    subjectDID,
    'MembershipCredential',
    { memberSince: '2024-01-01' }
);
```

### 4. Bluetooth/WiFi Mesh (`mesh/bluetooth_mesh.ts`)

Offline-first messaging using device-to-device communication.

**Features:**
- Bluetooth Low Energy discovery
- WiFi Direct high-bandwidth
- Merkle tree sync for efficiency
- Store-and-forward (DTN)
- Multi-hop routing

**Usage:**
```typescript
import { MeshNetwork } from './mesh/bluetooth_mesh';

const mesh = new MeshNetwork(ruvector, myId, myPublicKey);
await mesh.start();

// Send message (works offline!)
await mesh.sendMessage(recipientId, encryptedContent);

// Broadcast to all nearby
await mesh.broadcast(announcement);
```

### 5. Nostr Relay (`relay/nostr_relay.ts`)

Nostr-protocol compatible relay using RuVector for storage and search.

**Features:**
- NIP-01 basic protocol
- NIP-09 event deletion
- NIP-42 authentication
- NIP-50 semantic search (via RuVector vectors)
- Graph-based social queries

**Usage:**
```typescript
import { NostrRelay } from './relay/nostr_relay';

const relay = new NostrRelay(ruvector, 8080);

// Relay is now accepting WebSocket connections
// Connect with any Nostr client (Damus, Amethyst, etc.)
```

## Running Examples

### Prerequisites

```bash
npm install ruvector-wasm ws
```

### TypeScript Configuration

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "esModuleInterop": true,
    "strict": true
  }
}
```

### Run Individual Examples

```bash
# Transport selection
npx ts-node examples/transport/adaptive_transport.ts

# Crypto demo
npx ts-node examples/crypto/quantum_resistant.ts

# Identity demo
npx ts-node examples/identity/decentralized_identity.ts

# Mesh network
npx ts-node examples/mesh/bluetooth_mesh.ts

# Start relay
npx ts-node examples/relay/nostr_relay.ts
```

## Architecture Integration

All examples are designed to work together:

```
                    ┌─────────────────┐
                    │   Application   │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
     ┌────────▼────────┐ ┌───▼───┐ ┌───────▼───────┐
     │    Identity     │ │ Relay │ │     Mesh      │
     │   Management    │ │       │ │   Network     │
     └────────┬────────┘ └───┬───┘ └───────┬───────┘
              │              │              │
              └──────────────┼──────────────┘
                             │
                    ┌────────▼────────┐
                    │    Transport    │
                    │    Selector     │
                    └────────┬────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │          │         │         │          │
   ┌────▼────┐ ┌───▼───┐ ┌───▼───┐ ┌───▼───┐ ┌───▼───┐
   │ WebRTC  │ │  Tor  │ │  I2P  │ │ CDN   │ │ Mesh  │
   └─────────┘ └───────┘ └───────┘ └───────┘ └───────┘
```

## Security Considerations

1. **Key Management**: Store secret keys securely (encrypted at rest)
2. **Trust Verification**: Always verify signatures before trusting content
3. **Relay Selection**: Use multiple relays for redundancy
4. **Transport Fallback**: Configure multiple transport options
5. **Quantum Readiness**: Use hybrid crypto for future-proofing

## Contributing

See [RUVECTOR_CENSORSHIP_RESISTANT_DESIGN.md](../RUVECTOR_CENSORSHIP_RESISTANT_DESIGN.md) for the full architecture specification.

## License

MIT OR Apache-2.0

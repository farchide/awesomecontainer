/**
 * Decentralized Identity System
 *
 * Self-sovereign identity using cryptographic keys with:
 * - No central authority
 * - User-controlled credentials
 * - Web of Trust for reputation
 * - Sybil resistance mechanisms
 */

import { HybridCrypto, HybridKeyPair } from '../crypto/quantum_resistant';
import { RuVector } from 'ruvector-wasm';

// Decentralized Identifier (DID) following W3C spec
interface DID {
    method: 'key' | 'web' | 'nostr' | 'ruvector';
    identifier: string;
}

// DID Document
interface DIDDocument {
    '@context': string[];
    id: string;
    verificationMethod: VerificationMethod[];
    authentication: string[];
    keyAgreement: string[];
    service?: ServiceEndpoint[];
    created: string;
    updated: string;
}

interface VerificationMethod {
    id: string;
    type: string;
    controller: string;
    publicKeyMultibase?: string;
    publicKeyJwk?: JsonWebKey;
}

interface ServiceEndpoint {
    id: string;
    type: string;
    serviceEndpoint: string | string[];
}

// User Profile
interface UserProfile {
    did: string;
    displayName?: string;
    displayNameHash: string;  // For privacy
    bio?: string;
    avatar?: string;  // IPFS CID
    relays: string[];  // Nostr-style relay hints
    created: number;
    updated: number;
}

// Trust relationship
interface TrustEdge {
    from: string;  // DID of truster
    to: string;    // DID of trustee
    level: number; // 0.0 to 1.0
    category: 'identity' | 'content' | 'relay' | 'general';
    reason?: string;
    timestamp: number;
    signature: Uint8Array;
}

// Verifiable Credential
interface VerifiableCredential {
    '@context': string[];
    id: string;
    type: string[];
    issuer: string;  // DID of issuer
    issuanceDate: string;
    expirationDate?: string;
    credentialSubject: {
        id: string;  // DID of subject
        [key: string]: any;
    };
    proof: {
        type: string;
        created: string;
        verificationMethod: string;
        proofPurpose: string;
        proofValue: string;
    };
}

/**
 * Decentralized Identity Manager
 */
class IdentityManager {
    private ruvector: RuVector;
    private keyStore: Map<string, HybridKeyPair> = new Map();
    private currentDID: string | null = null;

    constructor(ruvector: RuVector) {
        this.ruvector = ruvector;
    }

    /**
     * Create a new decentralized identity
     */
    async createIdentity(): Promise<{
        did: string;
        document: DIDDocument;
        signingKey: HybridKeyPair;
        encryptionKey: HybridKeyPair;
    }> {
        // Generate key pairs
        const signingKey = await HybridCrypto.generateSigningKeyPair();
        const encryptionKey = await HybridCrypto.generateEncryptionKeyPair();

        // Create DID using did:key method
        // Format: did:key:z<multibase-encoded-public-key>
        const publicKeyMultibase = this.encodeMultibase(signingKey.classical.publicKey);
        const did = `did:key:${publicKeyMultibase}`;

        // Create DID Document
        const document: DIDDocument = {
            '@context': [
                'https://www.w3.org/ns/did/v1',
                'https://w3id.org/security/suites/ed25519-2020/v1',
                'https://w3id.org/security/suites/x25519-2020/v1'
            ],
            id: did,
            verificationMethod: [
                {
                    id: `${did}#signing-key-1`,
                    type: 'Ed25519VerificationKey2020',
                    controller: did,
                    publicKeyMultibase
                },
                {
                    id: `${did}#signing-key-quantum`,
                    type: 'MlDsa65VerificationKey2024',
                    controller: did,
                    publicKeyMultibase: this.encodeMultibase(signingKey.quantum.publicKey)
                },
                {
                    id: `${did}#encryption-key-1`,
                    type: 'X25519KeyAgreementKey2020',
                    controller: did,
                    publicKeyMultibase: this.encodeMultibase(encryptionKey.classical.publicKey)
                },
                {
                    id: `${did}#encryption-key-quantum`,
                    type: 'MlKem768KeyAgreementKey2024',
                    controller: did,
                    publicKeyMultibase: this.encodeMultibase(encryptionKey.quantum.publicKey)
                }
            ],
            authentication: [`${did}#signing-key-1`, `${did}#signing-key-quantum`],
            keyAgreement: [`${did}#encryption-key-1`, `${did}#encryption-key-quantum`],
            created: new Date().toISOString(),
            updated: new Date().toISOString()
        };

        // Store keys securely
        this.keyStore.set(`${did}#signing`, signingKey);
        this.keyStore.set(`${did}#encryption`, encryptionKey);

        // Store DID document in RuVector for discovery
        await this.ruvector.insert({
            id: did,
            type: 'DIDDocument',
            document,
            publicKeys: {
                signing: {
                    classical: Array.from(signingKey.classical.publicKey),
                    quantum: Array.from(signingKey.quantum.publicKey)
                },
                encryption: {
                    classical: Array.from(encryptionKey.classical.publicKey),
                    quantum: Array.from(encryptionKey.quantum.publicKey)
                }
            }
        });

        this.currentDID = did;
        console.log(`[Identity] Created DID: ${did.substring(0, 30)}...`);

        return { did, document, signingKey, encryptionKey };
    }

    /**
     * Resolve a DID to its document
     */
    async resolveDID(did: string): Promise<DIDDocument | null> {
        const parsed = this.parseDID(did);

        switch (parsed.method) {
            case 'key':
                // did:key is self-describing
                return this.resolveDidKey(did);

            case 'web':
                // Fetch from web
                return this.resolveDidWeb(did);

            case 'ruvector':
                // Query from distributed network
                return this.resolveDidRuvector(did);

            default:
                console.warn(`[Identity] Unknown DID method: ${parsed.method}`);
                return null;
        }
    }

    private parseDID(did: string): DID {
        const parts = did.split(':');
        return {
            method: parts[1] as DID['method'],
            identifier: parts.slice(2).join(':')
        };
    }

    private async resolveDidKey(did: string): Promise<DIDDocument> {
        // Extract public key from DID
        const identifier = did.split(':')[2];
        const publicKey = this.decodeMultibase(identifier);

        return {
            '@context': ['https://www.w3.org/ns/did/v1'],
            id: did,
            verificationMethod: [{
                id: `${did}#key-1`,
                type: 'Ed25519VerificationKey2020',
                controller: did,
                publicKeyMultibase: identifier
            }],
            authentication: [`${did}#key-1`],
            keyAgreement: [],
            created: new Date().toISOString(),
            updated: new Date().toISOString()
        };
    }

    private async resolveDidWeb(did: string): Promise<DIDDocument | null> {
        // did:web:example.com → https://example.com/.well-known/did.json
        const domain = did.split(':')[2];
        const url = `https://${domain}/.well-known/did.json`;

        try {
            const response = await fetch(url);
            return await response.json();
        } catch {
            return null;
        }
    }

    private async resolveDidRuvector(did: string): Promise<DIDDocument | null> {
        const result = await this.ruvector.query(
            'MATCH (d:DIDDocument {id: $did}) RETURN d.document',
            { did }
        );

        return result[0]?.document || null;
    }

    /**
     * Create a user profile
     */
    async createProfile(profile: Omit<UserProfile, 'did' | 'displayNameHash' | 'created' | 'updated'>): Promise<UserProfile> {
        if (!this.currentDID) {
            throw new Error('No identity created');
        }

        const now = Date.now();
        const displayNameHash = await this.hashDisplayName(profile.displayName || '');

        const userProfile: UserProfile = {
            did: this.currentDID,
            ...profile,
            displayNameHash,
            created: now,
            updated: now
        };

        // Store profile
        await this.ruvector.insert({
            id: `profile:${this.currentDID}`,
            type: 'UserProfile',
            ...userProfile
        });

        return userProfile;
    }

    /**
     * Hash display name for privacy-preserving search
     */
    private async hashDisplayName(name: string): Promise<string> {
        const normalized = name.toLowerCase().trim();
        const hash = await crypto.subtle.digest(
            'SHA-256',
            new TextEncoder().encode(normalized)
        );
        return Buffer.from(hash).toString('hex');
    }

    /**
     * Create trust relationship
     */
    async trustIdentity(
        targetDID: string,
        level: number,
        category: TrustEdge['category'],
        reason?: string
    ): Promise<TrustEdge> {
        if (!this.currentDID) {
            throw new Error('No identity created');
        }

        const signingKey = this.keyStore.get(`${this.currentDID}#signing`);
        if (!signingKey) {
            throw new Error('Signing key not found');
        }

        const timestamp = Date.now();
        const dataToSign = new TextEncoder().encode(
            JSON.stringify({ from: this.currentDID, to: targetDID, level, category, timestamp })
        );

        const signature = await HybridCrypto.sign(signingKey, dataToSign);

        const edge: TrustEdge = {
            from: this.currentDID,
            to: targetDID,
            level: Math.max(0, Math.min(1, level)),
            category,
            reason,
            timestamp,
            signature: new Uint8Array([...signature.classical, ...signature.quantum])
        };

        // Store in graph
        await this.ruvector.query(
            `MATCH (a:DIDDocument {id: $from})
             MATCH (b:DIDDocument {id: $to})
             MERGE (a)-[r:TRUSTS {category: $category}]->(b)
             SET r.level = $level, r.timestamp = $timestamp, r.reason = $reason`,
            { from: edge.from, to: edge.to, level: edge.level, category, timestamp, reason }
        );

        console.log(`[Identity] Trust edge: ${edge.from.substring(0, 20)}... → ${edge.to.substring(0, 20)}... (${level})`);

        return edge;
    }

    /**
     * Calculate trust score using Web of Trust
     */
    async calculateTrustScore(targetDID: string): Promise<number> {
        if (!this.currentDID) return 0;

        // Multi-hop trust calculation with decay
        const result = await this.ruvector.query(
            `MATCH path = shortestPath(
                (a:DIDDocument {id: $source})-[:TRUSTS*..5]->(b:DIDDocument {id: $target})
             )
             WITH path, relationships(path) AS rels
             RETURN reduce(score = 1.0, r IN rels | score * r.level * 0.9) AS trustScore`,
            { source: this.currentDID, target: targetDID }
        );

        return result[0]?.trustScore || 0;
    }

    /**
     * Issue a verifiable credential
     */
    async issueCredential(
        subjectDID: string,
        credentialType: string,
        claims: Record<string, any>,
        expirationDays?: number
    ): Promise<VerifiableCredential> {
        if (!this.currentDID) {
            throw new Error('No identity created');
        }

        const signingKey = this.keyStore.get(`${this.currentDID}#signing`);
        if (!signingKey) {
            throw new Error('Signing key not found');
        }

        const now = new Date();
        const credentialId = `urn:uuid:${crypto.randomUUID()}`;

        const credential: VerifiableCredential = {
            '@context': [
                'https://www.w3.org/2018/credentials/v1',
                'https://w3id.org/security/suites/ed25519-2020/v1'
            ],
            id: credentialId,
            type: ['VerifiableCredential', credentialType],
            issuer: this.currentDID,
            issuanceDate: now.toISOString(),
            credentialSubject: {
                id: subjectDID,
                ...claims
            },
            proof: {
                type: 'Ed25519Signature2020',
                created: now.toISOString(),
                verificationMethod: `${this.currentDID}#signing-key-1`,
                proofPurpose: 'assertionMethod',
                proofValue: '' // Will be filled
            }
        };

        if (expirationDays) {
            const expiration = new Date(now);
            expiration.setDate(expiration.getDate() + expirationDays);
            credential.expirationDate = expiration.toISOString();
        }

        // Sign the credential
        const credentialWithoutProof = { ...credential };
        delete (credentialWithoutProof as any).proof;

        const dataToSign = new TextEncoder().encode(JSON.stringify(credentialWithoutProof));
        const signature = await HybridCrypto.sign(signingKey, dataToSign);

        credential.proof.proofValue = Buffer.from(signature.classical).toString('base64');

        // Store credential
        await this.ruvector.insert({
            id: credentialId,
            type: 'VerifiableCredential',
            credential,
            issuer: this.currentDID,
            subject: subjectDID
        });

        console.log(`[Identity] Issued credential: ${credentialType} to ${subjectDID.substring(0, 20)}...`);

        return credential;
    }

    /**
     * Verify a credential
     */
    async verifyCredential(credential: VerifiableCredential): Promise<{
        valid: boolean;
        issuerTrust: number;
        errors: string[];
    }> {
        const errors: string[] = [];

        // Check expiration
        if (credential.expirationDate) {
            if (new Date(credential.expirationDate) < new Date()) {
                errors.push('Credential has expired');
            }
        }

        // Resolve issuer DID
        const issuerDoc = await this.resolveDID(credential.issuer);
        if (!issuerDoc) {
            errors.push('Could not resolve issuer DID');
            return { valid: false, issuerTrust: 0, errors };
        }

        // Find verification method
        const verificationMethodId = credential.proof.verificationMethod;
        const verificationMethod = issuerDoc.verificationMethod.find(
            vm => vm.id === verificationMethodId
        );

        if (!verificationMethod) {
            errors.push('Verification method not found in issuer DID document');
            return { valid: false, issuerTrust: 0, errors };
        }

        // Verify signature (simplified - would use actual verification)
        // In production, decode publicKeyMultibase and verify

        // Calculate issuer trust
        const issuerTrust = await this.calculateTrustScore(credential.issuer);

        return {
            valid: errors.length === 0,
            issuerTrust,
            errors
        };
    }

    /**
     * Sybil resistance: Proof of Work for identity creation
     */
    async generateIdentityProofOfWork(difficulty: number = 4): Promise<{
        nonce: number;
        hash: string;
    }> {
        if (!this.currentDID) {
            throw new Error('No identity created');
        }

        const target = '0'.repeat(difficulty);
        let nonce = 0;

        while (true) {
            const data = `${this.currentDID}:${nonce}`;
            const hashBuffer = await crypto.subtle.digest(
                'SHA-256',
                new TextEncoder().encode(data)
            );
            const hash = Buffer.from(hashBuffer).toString('hex');

            if (hash.startsWith(target)) {
                // Store proof
                await this.ruvector.query(
                    `MATCH (d:DIDDocument {id: $did})
                     SET d.proofOfWork = $pow`,
                    { did: this.currentDID, pow: { nonce, hash, difficulty } }
                );

                console.log(`[Identity] PoW completed: ${hash.substring(0, 16)}... (nonce: ${nonce})`);
                return { nonce, hash };
            }

            nonce++;

            // Progress update every 100k
            if (nonce % 100000 === 0) {
                console.log(`[Identity] PoW progress: ${nonce} hashes...`);
            }
        }
    }

    /**
     * Verify identity has valid proof of work
     */
    async verifyIdentityProofOfWork(did: string, minDifficulty: number = 4): Promise<boolean> {
        const result = await this.ruvector.query(
            'MATCH (d:DIDDocument {id: $did}) RETURN d.proofOfWork',
            { did }
        );

        const pow = result[0]?.proofOfWork;
        if (!pow) return false;

        // Verify the hash
        const data = `${did}:${pow.nonce}`;
        const hashBuffer = await crypto.subtle.digest(
            'SHA-256',
            new TextEncoder().encode(data)
        );
        const hash = Buffer.from(hashBuffer).toString('hex');

        return hash === pow.hash && pow.difficulty >= minDifficulty;
    }

    // Helper: Encode to multibase (simplified - using base58btc 'z' prefix)
    private encodeMultibase(data: Uint8Array): string {
        // In production, use proper multibase encoding
        return 'z' + Buffer.from(data).toString('base64url');
    }

    // Helper: Decode from multibase
    private decodeMultibase(encoded: string): Uint8Array {
        // Remove prefix and decode
        return new Uint8Array(Buffer.from(encoded.substring(1), 'base64url'));
    }

    /**
     * Export identity for backup
     */
    async exportIdentity(): Promise<string> {
        if (!this.currentDID) {
            throw new Error('No identity created');
        }

        const signingKey = this.keyStore.get(`${this.currentDID}#signing`);
        const encryptionKey = this.keyStore.get(`${this.currentDID}#encryption`);

        const exportData = {
            did: this.currentDID,
            signingKey: {
                classical: {
                    public: Array.from(signingKey!.classical.publicKey),
                    secret: Array.from(signingKey!.classical.secretKey)
                },
                quantum: {
                    public: Array.from(signingKey!.quantum.publicKey),
                    secret: Array.from(signingKey!.quantum.secretKey)
                }
            },
            encryptionKey: {
                classical: {
                    public: Array.from(encryptionKey!.classical.publicKey),
                    secret: Array.from(encryptionKey!.classical.secretKey)
                },
                quantum: {
                    public: Array.from(encryptionKey!.quantum.publicKey),
                    secret: Array.from(encryptionKey!.quantum.secretKey)
                }
            }
        };

        // Encrypt with user password (simplified)
        return JSON.stringify(exportData);
    }
}

// Usage Example
async function demonstrateIdentity() {
    console.log('=== Decentralized Identity Demo ===\n');

    const ruvector = new (class {
        async query(q: string, p?: any) { return []; }
        async insert(d: any) { return 'ok'; }
    })() as any;

    const identity = new IdentityManager(ruvector);

    // Create identity
    console.log('Creating decentralized identity...');
    const { did, document } = await identity.createIdentity();
    console.log(`\nDID: ${did}`);
    console.log(`Verification methods: ${document.verificationMethod.length}`);
    console.log(`  - Classical signing (Ed25519)`);
    console.log(`  - Quantum signing (ML-DSA-65)`);
    console.log(`  - Classical encryption (X25519)`);
    console.log(`  - Quantum encryption (ML-KEM-768)\n`);

    // Create profile
    console.log('Creating user profile...');
    const profile = await identity.createProfile({
        displayName: 'Alice',
        bio: 'Privacy advocate',
        relays: ['wss://relay.example.com']
    });
    console.log(`Profile created for: ${profile.displayName}\n`);

    // Generate proof of work (Sybil resistance)
    console.log('Generating proof of work (difficulty: 2 for demo)...');
    const pow = await identity.generateIdentityProofOfWork(2);
    console.log(`PoW hash: ${pow.hash.substring(0, 32)}...\n`);

    // Issue credential
    console.log('Issuing verifiable credential...');
    const credential = await identity.issueCredential(
        did,
        'MembershipCredential',
        { memberSince: '2024-01-01', tier: 'founding' },
        365
    );
    console.log(`Credential type: ${credential.type.join(', ')}`);
    console.log(`Expires: ${credential.expirationDate}\n`);

    console.log('=== Identity System Ready ===');
    console.log('Users can now:');
    console.log('  - Create self-sovereign identities');
    console.log('  - Build trust relationships (Web of Trust)');
    console.log('  - Issue and verify credentials');
    console.log('  - Prove identity without central authority');
}

export { IdentityManager, DIDDocument, UserProfile, TrustEdge, VerifiableCredential };

/**
 * Encrypted key-value OAuth token store for generated integrations.
 *
 * Wraps any durable key-value service (Redis, Postgres, Deno KV, a cloud KV
 * API) in the `RefreshCapableTokenStore` contract that `configureTokenStore`
 * in `token-store.ts` expects. Every value is encrypted at rest with
 * AES-256-GCM via the Web Crypto API before it reaches the backend:
 *
 * - A fresh random 96-bit IV is generated for every encryption.
 * - The storage key is bound as AES-GCM additional authenticated data, so a
 *   ciphertext copied between storage slots fails authentication.
 * - The key comes from the `TOKEN_ENCRYPTION_KEY` environment variable
 *   (64 hex characters = 256 bits). There is NO plaintext fallback: creating
 *   the store without a valid key throws, and values that are not in the
 *   expected encrypted envelope are refused on read.
 *
 * Generate a key once per deployment and set it before startup:
 *
 * ```sh
 * openssl rand -hex 32
 * ```
 *
 * Concurrency (compare-and-swap, refresh locking) is delegated to the
 * backend so the guarantees hold across workers; this module never emulates
 * distributed behavior in process memory. See `token-store-examples.ts` for
 * reference backends and wiring.
 */

import type {
  OAuthTokens,
  OAuthTokenSnapshot,
  RefreshCapableTokenStore,
  StoredOAuthState,
} from "veryfront/oauth";

/**
 * Minimal durable backend contract. All five operations are required; the
 * atomic ones are what make token refresh and one-shot OAuth state safe
 * across workers.
 */
export interface EncryptedKvBackend {
  /** Read the raw stored value for a key, or null when absent. */
  get(key: string): Promise<string | null>;
  /**
   * Durably write a value, replacing any existing one. `expiresInMs`, when
   * provided, is a TTL after which the backend may drop the row.
   */
  set(key: string, value: string, options?: { expiresInMs?: number }): Promise<void>;
  /** Remove a key. Deleting an absent key is not an error. */
  delete(key: string): Promise<void>;
  /**
   * Atomically replace `expected` with `next`. `expected === null` requires
   * the key to be absent; `next === null` deletes the key. Returns false
   * (without writing) when the current value does not match `expected`.
   */
  compareAndSwap(
    key: string,
    expected: string | null,
    next: string | null,
    options?: { expiresInMs?: number },
  ): Promise<boolean>;
  /**
   * Run `operation` while holding a mutual-exclusion lease for `key` that is
   * visible to every worker (for example a Redis lock or an advisory lock).
   * The lease must be bounded so a crashed holder cannot block refresh
   * forever.
   */
  withLock<T>(key: string, operation: () => Promise<T>): Promise<T>;
}

const ENCRYPTION_KEY_ENV_VAR = "TOKEN_ENCRYPTION_KEY";
const ENVELOPE_PREFIX = "vf-aes-gcm.v1:";
const AES_GCM_IV_BYTES = 12;
const AES_GCM_TAG_BYTES = 16;
const AES_KEY_BYTES = 32;
const MAX_PLAINTEXT_BYTES = 64 * 1024;
const MAX_ENCRYPTED_BYTES = MAX_PLAINTEXT_BYTES + AES_GCM_IV_BYTES + AES_GCM_TAG_BYTES;
const MAX_ENCODED_LENGTH = Math.ceil(MAX_ENCRYPTED_BYTES / 3) * 4 + ENVELOPE_PREFIX.length;
const BASE64_CHUNK_BYTES = 0x8000;
const MAX_KEY_COMPONENT_LENGTH = 1_024;
const MAX_STATE_KEY_LENGTH = 1_024;
const STATE_TTL_MS = 10 * 60 * 1_000;
const STATE_CLOCK_SKEW_MS = 60 * 1_000;

const TOKENS_KEY_PREFIX = "veryfront:oauth:v1:tokens:";
const STATE_KEY_PREFIX = "veryfront:oauth:v1:state:";
const REFRESH_LOCK_KEY_PREFIX = "veryfront:oauth:v1:refresh-lock:";

const REQUIRED_BACKEND_METHODS = [
  "get",
  "set",
  "delete",
  "compareAndSwap",
  "withLock",
] as const;

function readEnvironmentVariable(name: string): string | undefined {
  if (typeof process !== "undefined" && process.env) return process.env[name];
  return (globalThis as { Deno?: { env?: { get?: (name: string) => string | undefined } } })
    .Deno?.env?.get?.(name);
}

/** Generate a fresh 256-bit key encoded as 64 hex characters. */
export function generateEncryptionKey(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(AES_KEY_BYTES)))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function parseEncryptionKeyHex(keyHex: string): Uint8Array<ArrayBuffer> {
  if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) {
    throw new TypeError(
      `${ENCRYPTION_KEY_ENV_VAR} must be exactly 64 hexadecimal characters ` +
        "(a 256-bit AES key). Generate one with `openssl rand -hex 32`.",
    );
  }
  const key = new Uint8Array(AES_KEY_BYTES);
  for (let index = 0; index < key.length; index++) {
    key[index] = Number.parseInt(keyHex.slice(index * 2, index * 2 + 2), 16);
  }
  return key;
}

/**
 * Resolve the configured encryption key or fail closed. This store never
 * writes plaintext credentials, so a missing key is a hard error rather than
 * a downgrade.
 */
function requireEncryptionKeyBytes(): Uint8Array<ArrayBuffer> {
  const configured = readEnvironmentVariable(ENCRYPTION_KEY_ENV_VAR);
  if (configured === undefined || configured === "") {
    throw new Error(
      `${ENCRYPTION_KEY_ENV_VAR} is not set. The encrypted token store refuses ` +
        "to persist plaintext OAuth credentials. Generate a key with " +
        "`openssl rand -hex 32` (or generateEncryptionKey()) and set " +
        `${ENCRYPTION_KEY_ENV_VAR} before starting the app.`,
    );
  }
  return parseEncryptionKeyHex(configured);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.byteLength; offset += BASE64_CHUNK_BYTES) {
    const chunk = bytes.subarray(offset, offset + BASE64_CHUNK_BYTES);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function base64ToBytes(encoded: string): Uint8Array<ArrayBuffer> {
  if (
    encoded.length === 0 || encoded.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)
  ) {
    throw new TypeError("Encrypted OAuth value has invalid base64 encoding");
  }
  const binary = atob(encoded);
  if (
    binary.length < AES_GCM_IV_BYTES + AES_GCM_TAG_BYTES ||
    binary.length > MAX_ENCRYPTED_BYTES
  ) {
    throw new RangeError("Encrypted OAuth value has an invalid size");
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function requireKeyComponent(value: string, label: string): string {
  if (
    typeof value !== "string" || value.length === 0 ||
    value.length > MAX_KEY_COMPONENT_LENGTH || value.trim() !== value
  ) {
    throw new TypeError(
      `${label} must be a trimmed, non-empty string of at most ${MAX_KEY_COMPONENT_LENGTH} characters`,
    );
  }
  return value;
}

function tokensStorageKey(serviceId: string, userId: string): string {
  return TOKENS_KEY_PREFIX + JSON.stringify([
    requireKeyComponent(serviceId, "serviceId"),
    requireKeyComponent(userId, "userId"),
  ]);
}

function refreshLockKey(serviceId: string, userId: string): string {
  return REFRESH_LOCK_KEY_PREFIX + JSON.stringify([
    requireKeyComponent(serviceId, "serviceId"),
    requireKeyComponent(userId, "userId"),
  ]);
}

function stateStorageKey(state: string): string {
  if (typeof state !== "string" || state.length === 0 || state.length > MAX_STATE_KEY_LENGTH) {
    throw new RangeError(
      `state must contain between 1 and ${MAX_STATE_KEY_LENGTH} characters`,
    );
  }
  return STATE_KEY_PREFIX + state;
}

interface StoredTokenEntry {
  revision: string;
  tokens: OAuthTokens;
}

function requireTokenRow(value: unknown): OAuthTokens {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("OAuth token row must be an object");
  }
  const tokens = value as OAuthTokens;
  if (typeof tokens.accessToken !== "string" || tokens.accessToken.length === 0) {
    throw new TypeError("OAuth token row must contain a non-empty accessToken");
  }
  if (
    tokens.expiresAt !== undefined &&
    (typeof tokens.expiresAt !== "number" || !Number.isSafeInteger(tokens.expiresAt) ||
      tokens.expiresAt < 0)
  ) {
    throw new TypeError("OAuth token expiresAt must be a non-negative safe integer");
  }
  return tokens;
}

function requireTokenEntry(value: unknown): StoredTokenEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Stored OAuth token entry must be an object");
  }
  const entry = value as StoredTokenEntry;
  if (typeof entry.revision !== "string" || entry.revision.length === 0) {
    throw new TypeError("Stored OAuth token entry must contain a revision");
  }
  return { revision: entry.revision, tokens: requireTokenRow(entry.tokens) };
}

function requireStateRow(value: unknown): StoredOAuthState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Stored OAuth state row must be an object");
  }
  const meta = value as StoredOAuthState;
  if (typeof meta.userId !== "string" || meta.userId.length === 0) {
    throw new TypeError("Stored OAuth state row must contain a userId");
  }
  if (typeof meta.serviceId !== "string" || meta.serviceId.length === 0) {
    throw new TypeError("Stored OAuth state row must contain a serviceId");
  }
  if (typeof meta.createdAt !== "number" || !Number.isSafeInteger(meta.createdAt)) {
    throw new TypeError("Stored OAuth state row must contain a createdAt timestamp");
  }
  return meta;
}

function isFreshState(createdAt: number, now: number): boolean {
  return createdAt <= now + STATE_CLOCK_SKEW_MS &&
    now - createdAt <= STATE_TTL_MS + STATE_CLOCK_SKEW_MS;
}

function assertBackend(backend: EncryptedKvBackend): void {
  if (!backend || typeof backend !== "object") {
    throw new TypeError("Encrypted token store backend must be an object");
  }
  for (const method of REQUIRED_BACKEND_METHODS) {
    if (typeof backend[method] !== "function") {
      throw new TypeError(`Encrypted token store backend must implement ${method}()`);
    }
  }
}

class EnvelopeCipher {
  readonly #key: Promise<CryptoKey>;

  constructor(keyBytes: Uint8Array<ArrayBuffer>) {
    this.#key = crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, [
      "encrypt",
      "decrypt",
    ]);
    keyBytes.fill(0);
  }

  async seal(storageKey: string, value: unknown): Promise<string> {
    const plaintext = new TextEncoder().encode(JSON.stringify(value));
    if (plaintext.byteLength > MAX_PLAINTEXT_BYTES) {
      throw new RangeError(`Stored OAuth value exceeds ${MAX_PLAINTEXT_BYTES} bytes`);
    }
    const iv = crypto.getRandomValues(new Uint8Array(AES_GCM_IV_BYTES));
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(storageKey) },
        await this.#key,
        plaintext,
      ),
    );
    const combined = new Uint8Array(iv.byteLength + ciphertext.byteLength);
    combined.set(iv);
    combined.set(ciphertext, iv.byteLength);
    return ENVELOPE_PREFIX + bytesToBase64(combined);
  }

  async open(storageKey: string, stored: string): Promise<unknown> {
    if (typeof stored !== "string" || stored.length > MAX_ENCODED_LENGTH) {
      throw new TypeError("Stored OAuth value must be a bounded string");
    }
    if (!stored.startsWith(ENVELOPE_PREFIX)) {
      throw new Error(
        `Stored OAuth value is not in the ${ENVELOPE_PREFIX.slice(0, -1)} envelope ` +
          "format. This store never reads plaintext credentials; re-authenticate " +
          "affected users to replace legacy rows.",
      );
    }
    const combined = base64ToBytes(stored.slice(ENVELOPE_PREFIX.length));
    const iv = combined.subarray(0, AES_GCM_IV_BYTES);
    const ciphertext = combined.subarray(AES_GCM_IV_BYTES);
    let plaintext: ArrayBuffer;
    try {
      plaintext = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(storageKey) },
        await this.#key,
        ciphertext,
      );
    } catch (cause) {
      throw new Error(
        "Encrypted OAuth value failed authentication (wrong key, corrupted " +
          "data, or a value moved between storage slots)",
        { cause },
      );
    }
    return JSON.parse(new TextDecoder().decode(plaintext));
  }
}

/**
 * Build a `RefreshCapableTokenStore` over a durable key-value backend with
 * AES-256-GCM encryption at rest.
 *
 * Fails closed at creation time when `TOKEN_ENCRYPTION_KEY` is missing or
 * malformed, and when the backend does not provide the atomic operations
 * that safe multi-worker refresh requires.
 *
 * Wire it once during startup:
 *
 * ```ts
 * import { configureTokenStore } from "./token-store.ts";
 * import { createEncryptedTokenStore } from "./encrypted-token-store.ts";
 *
 * configureTokenStore(createEncryptedTokenStore(myKvBackend));
 * ```
 */
export function createEncryptedTokenStore(
  backend: EncryptedKvBackend,
): RefreshCapableTokenStore {
  assertBackend(backend);
  const cipher = new EnvelopeCipher(requireEncryptionKeyBytes());

  async function readTokenEntry(
    serviceId: string,
    userId: string,
  ): Promise<{ key: string; raw: string; entry: StoredTokenEntry } | null> {
    const key = tokensStorageKey(serviceId, userId);
    const raw = await backend.get(key);
    if (raw === null) return null;
    return { key, raw, entry: requireTokenEntry(await cipher.open(key, raw)) };
  }

  return {
    async getTokens(serviceId: string, userId: string): Promise<OAuthTokens | null> {
      return (await readTokenEntry(serviceId, userId))?.entry.tokens ?? null;
    },

    async getTokenSnapshot(
      serviceId: string,
      userId: string,
    ): Promise<OAuthTokenSnapshot | null> {
      return (await readTokenEntry(serviceId, userId))?.entry ?? null;
    },

    async setTokens(serviceId: string, userId: string, tokens: OAuthTokens): Promise<void> {
      const key = tokensStorageKey(serviceId, userId);
      const entry: StoredTokenEntry = {
        revision: crypto.randomUUID(),
        tokens: requireTokenRow(tokens),
      };
      await backend.set(key, await cipher.seal(key, entry));
    },

    async compareAndSetTokens(
      serviceId: string,
      userId: string,
      expectedRevision: string,
      tokens: OAuthTokens,
    ): Promise<boolean> {
      if (typeof expectedRevision !== "string" || expectedRevision.length === 0) {
        throw new TypeError("Expected OAuth token revision must be a non-empty string");
      }
      const current = await readTokenEntry(serviceId, userId);
      if (!current || current.entry.revision !== expectedRevision) return false;
      const next: StoredTokenEntry = {
        revision: crypto.randomUUID(),
        tokens: requireTokenRow(tokens),
      };
      return backend.compareAndSwap(
        current.key,
        current.raw,
        await cipher.seal(current.key, next),
      );
    },

    withTokenRefreshLock<T>(
      serviceId: string,
      userId: string,
      operation: () => Promise<T>,
    ): Promise<T> {
      return backend.withLock(refreshLockKey(serviceId, userId), operation);
    },

    async clearTokens(serviceId: string, userId: string): Promise<void> {
      await backend.delete(tokensStorageKey(serviceId, userId));
    },

    async setState(state: string, metadata: StoredOAuthState): Promise<void> {
      const key = stateStorageKey(state);
      const row = requireStateRow(metadata);
      if (!isFreshState(row.createdAt, Date.now())) {
        throw new RangeError("OAuth state createdAt is outside the acceptance window");
      }
      const inserted = await backend.compareAndSwap(
        key,
        null,
        await cipher.seal(key, row),
        { expiresInMs: STATE_TTL_MS + STATE_CLOCK_SKEW_MS },
      );
      if (!inserted) throw new Error("OAuth state already exists");
    },

    async consumeState(state: string): Promise<StoredOAuthState | null> {
      const key = stateStorageKey(state);
      const raw = await backend.get(key);
      if (raw === null) return null;
      // One-shot semantics: only the caller that atomically removes the row
      // may redeem it, so a replayed callback cannot reuse the state.
      const consumed = await backend.compareAndSwap(key, raw, null);
      if (!consumed) return null;
      const row = requireStateRow(await cipher.open(key, raw));
      return isFreshState(row.createdAt, Date.now()) ? row : null;
    },
  };
}

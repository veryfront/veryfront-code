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
 * Keep the configured key while encrypted rows still use it. Replacing the
 * key makes existing rows unreadable. Delete affected rows and have users
 * reconnect before removing the old key; this v1 envelope does not support
 * decrypting with multiple keys during rotation.
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
const MAX_SERVICE_ID_LENGTH = 128;
const MAX_SCOPE_COUNT = 100;
const MAX_REDIRECT_URI_LENGTH = 8_192;
const MAX_TOKEN_VALUE_LENGTH = 65_536;
const MAX_TOKEN_TYPE_LENGTH = 256;
const MAX_SCOPE_WIRE_LENGTH = 4_096;

const SERVICE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SCOPE_TOKEN_PATTERN = /^[\x21\x23-\x5B\x5D-\x7E]+$/;
const PKCE_VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/;

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
    value.length > MAX_KEY_COMPONENT_LENGTH || value.trim() !== value ||
    hasAsciiControlCharacter(value)
  ) {
    throw new TypeError(
      `${label} must be a trimmed, non-empty string of at most ${MAX_KEY_COMPONENT_LENGTH} characters without control characters`,
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
  if (typeof state !== "string") {
    throw new TypeError("state must be a string");
  }
  if (state.length === 0 || state.length > MAX_STATE_KEY_LENGTH) {
    throw new RangeError(
      `state must contain between 1 and ${MAX_STATE_KEY_LENGTH} characters`,
    );
  }
  if (state.trim() !== state || hasAsciiControlCharacter(state)) {
    throw new TypeError("state must not contain surrounding whitespace or control characters");
  }
  return STATE_KEY_PREFIX + JSON.stringify([state]);
}

interface StoredTokenEntry {
  revision: string;
  tokens: OAuthTokens;
}

function ownDataValue(record: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function hasAsciiControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function requireJsonDataValue(value: unknown, label: string): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${label} must contain only finite JSON numbers`);
    }
    return value;
  }
  if (Array.isArray(value)) {
    return Array.from({ length: value.length }, (_, index) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor)) {
        throw new TypeError(`${label} must contain only own data values`);
      }
      return requireJsonDataValue(descriptor.value, label);
    });
  }
  if (!value || typeof value !== "object") {
    throw new TypeError(`${label} must contain only JSON data values`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must contain only plain JSON data objects`);
  }
  const snapshot: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) {
      throw new TypeError(`${label} must contain only own data values`);
    }
    snapshot[key] = requireJsonDataValue(descriptor.value, label);
  }
  return snapshot;
}

function requireMetadata(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Stored OAuth state metadata must be a plain object");
  }
  return requireJsonDataValue(value, "Stored OAuth state metadata") as Record<string, unknown>;
}

function requireOptionalTokenString(
  record: object,
  key: string,
  maxLength: number,
): string | undefined {
  const value = ownDataValue(record, key);
  if (value === undefined) return undefined;
  if (
    typeof value !== "string" || value.length === 0 || value.length > maxLength ||
    value.trim() !== value || hasAsciiControlCharacter(value)
  ) {
    throw new TypeError(`OAuth token row ${key} must be a safe bounded string`);
  }
  return value;
}

function requireTokenRow(value: unknown): OAuthTokens {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("OAuth token row must be an object");
  }
  const accessToken = requireOptionalTokenString(value, "accessToken", MAX_TOKEN_VALUE_LENGTH);
  if (accessToken === undefined) {
    throw new TypeError("OAuth token row must contain a non-empty accessToken");
  }
  const refreshToken = requireOptionalTokenString(value, "refreshToken", MAX_TOKEN_VALUE_LENGTH);
  const tokenType = requireOptionalTokenString(value, "tokenType", MAX_TOKEN_TYPE_LENGTH);
  const scopeValue = ownDataValue(value, "scope");
  let scope: string | undefined;
  if (scopeValue !== undefined) {
    if (
      typeof scopeValue !== "string" || hasAsciiControlCharacter(scopeValue) ||
      scopeValue.length > MAX_SCOPE_WIRE_LENGTH
    ) {
      throw new TypeError("OAuth token row scope must be a safe bounded string");
    }
    scope = scopeValue.trim();
    if (scope.length === 0) {
      throw new TypeError("OAuth token row scope must be a safe bounded string");
    }
  }
  const idToken = requireOptionalTokenString(value, "idToken", MAX_TOKEN_VALUE_LENGTH);
  const expiresAt = ownDataValue(value, "expiresAt");
  if (
    expiresAt !== undefined &&
    (typeof expiresAt !== "number" || !Number.isSafeInteger(expiresAt) || expiresAt < 0)
  ) {
    throw new TypeError("OAuth token expiresAt must be a non-negative safe integer");
  }
  return {
    accessToken,
    ...(refreshToken === undefined ? {} : { refreshToken }),
    ...(expiresAt === undefined ? {} : { expiresAt }),
    ...(tokenType === undefined ? {} : { tokenType }),
    ...(scope === undefined ? {} : { scope }),
    ...(idToken === undefined ? {} : { idToken }),
  };
}

function requireTokenEntry(value: unknown): StoredTokenEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Stored OAuth token entry must be an object");
  }
  const revision = ownDataValue(value, "revision");
  if (typeof revision !== "string" || revision.length === 0) {
    throw new TypeError("Stored OAuth token entry must contain a revision");
  }
  return { revision, tokens: requireTokenRow(ownDataValue(value, "tokens")) };
}

function requireStateRow(value: unknown): StoredOAuthState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Stored OAuth state row must be an object");
  }
  const userId = ownDataValue(value, "userId");
  const serviceId = ownDataValue(value, "serviceId");
  const redirectUri = ownDataValue(value, "redirectUri");
  const scopes = ownDataValue(value, "scopes");
  const createdAt = ownDataValue(value, "createdAt");
  const codeVerifier = ownDataValue(value, "codeVerifier");
  const metadata = requireMetadata(ownDataValue(value, "metadata"));
  if (
    typeof userId !== "string" || userId.length === 0 ||
    userId.length > MAX_KEY_COMPONENT_LENGTH || userId.trim() !== userId
  ) {
    throw new TypeError("Stored OAuth state row must contain a userId");
  }
  if (
    typeof serviceId !== "string" || serviceId.length > MAX_SERVICE_ID_LENGTH ||
    !SERVICE_ID_PATTERN.test(serviceId)
  ) {
    throw new TypeError("Stored OAuth state row must contain a serviceId");
  }
  let parsedRedirectUri: URL;
  try {
    if (
      typeof redirectUri !== "string" || redirectUri.length > MAX_REDIRECT_URI_LENGTH ||
      redirectUri.trim() !== redirectUri || hasAsciiControlCharacter(redirectUri) ||
      redirectUri.includes("\\")
    ) {
      throw new TypeError();
    }
    parsedRedirectUri = new URL(redirectUri);
  } catch {
    throw new TypeError("Stored OAuth state row must contain a valid redirectUri");
  }
  const isLoopback = parsedRedirectUri.hostname === "localhost" ||
    parsedRedirectUri.hostname === "127.0.0.1" ||
    parsedRedirectUri.hostname === "[::1]" || parsedRedirectUri.hostname === "::1";
  if (
    parsedRedirectUri.username || parsedRedirectUri.password || parsedRedirectUri.hash ||
    (parsedRedirectUri.protocol !== "https:" &&
      !(parsedRedirectUri.protocol === "http:" && isLoopback))
  ) {
    throw new TypeError("Stored OAuth state row must contain a valid redirectUri");
  }
  if (!Array.isArray(scopes) || scopes.length > MAX_SCOPE_COUNT) {
    throw new TypeError("Stored OAuth state row must contain valid scopes");
  }
  const scopeSnapshot: string[] = [];
  for (let index = 0; index < scopes.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(scopes, String(index));
    if (
      !descriptor || !("value" in descriptor) || typeof descriptor.value !== "string" ||
      !SCOPE_TOKEN_PATTERN.test(descriptor.value)
    ) {
      throw new TypeError("Stored OAuth state row must contain valid scopes");
    }
    scopeSnapshot.push(descriptor.value);
  }
  if (scopeSnapshot.join(" ").length > MAX_SCOPE_WIRE_LENGTH) {
    throw new TypeError("Stored OAuth state row must contain valid scopes");
  }
  if (typeof createdAt !== "number" || !Number.isSafeInteger(createdAt) || createdAt <= 0) {
    throw new TypeError("Stored OAuth state row must contain a createdAt timestamp");
  }
  if (
    codeVerifier !== undefined &&
    (typeof codeVerifier !== "string" || !PKCE_VERIFIER_PATTERN.test(codeVerifier))
  ) {
    throw new TypeError("Stored OAuth state row has an invalid codeVerifier");
  }
  return {
    userId,
    serviceId,
    redirectUri,
    scopes: scopeSnapshot,
    createdAt,
    ...(codeVerifier === undefined ? {} : { codeVerifier }),
    ...(metadata === undefined ? {} : { metadata }),
  };
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
      try {
        const row = requireStateRow(await cipher.open(key, raw));
        return isFreshState(row.createdAt, Date.now()) ? row : null;
      } catch {
        return null;
      }
    },
  };
}

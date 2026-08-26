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
 * Key rotation: set `TOKEN_ENCRYPTION_KEY` to the new key and move the old
 * key to `TOKEN_ENCRYPTION_KEY_PREVIOUS`. New writes are sealed with the new
 * key (the v2 envelope records a key id derived from the key), while rows
 * sealed with the previous key stay readable. Every token row decrypted with
 * a non-current key is transparently re-sealed with the current key: always
 * on the next write, and best-effort on every read, so rotation converges
 * even for rows that are read but never rewritten. Use
 * `checkEncryptedTokenStoreRotation` to confirm no rows still need the
 * previous key, then remove `TOKEN_ENCRYPTION_KEY_PREVIOUS`; stragglers
 * degrade to "disconnected" and recover on reconnect.
 *
 * Legacy v1 envelopes (no key id) were written only by earlier revisions of
 * this template; they are decrypted by trying every configured key and are
 * upgraded to v2 by the same re-seal-on-read path, so the compatibility
 * branch retires itself as rows are read.
 *
 * Undecryptable token rows (unknown key, tampering, legacy plaintext) never
 * fail a whole request: the token read paths log a warning and report the
 * integration as disconnected, so the recovery is simply reconnecting (a
 * fresh `setTokens` overwrites the row; `clearTokens` removes it).
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
  OAuthScopeSource,
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

export interface EncryptedKvRotationScanBackend extends EncryptedKvBackend {
  /**
   * Iterate stored rows whose key starts with `prefix`. Use a backend-native
   * bounded cursor or paginated scan; do not load an unbounded keyspace into
   * memory before yielding.
   */
  scan(prefix: string): AsyncIterable<{ key: string; value: string }>;
}

export interface EncryptedTokenStoreRotationReport {
  scannedRows: number;
  currentKeyRows: number;
  previousKeyRows: number;
  unreadableRows: number;
  complete: boolean;
}

const ENCRYPTION_KEY_ENV_VAR = "TOKEN_ENCRYPTION_KEY";
const PREVIOUS_ENCRYPTION_KEY_ENV_VAR = "TOKEN_ENCRYPTION_KEY_PREVIOUS";
const ENVELOPE_PREFIX = "vf-aes-gcm.v2:";
const LEGACY_ENVELOPE_PREFIX = "vf-aes-gcm.v1:";
const KEY_ID_HEX_LENGTH = 16;
const KEY_ID_PATTERN = /^[0-9a-f]{16}$/;
const AES_GCM_IV_BYTES = 12;
const AES_GCM_TAG_BYTES = 16;
const AES_KEY_BYTES = 32;
const MAX_PLAINTEXT_BYTES = 64 * 1024;
const MAX_ENCRYPTED_BYTES = MAX_PLAINTEXT_BYTES + AES_GCM_IV_BYTES + AES_GCM_TAG_BYTES;
const MAX_ENCODED_LENGTH = Math.ceil(MAX_ENCRYPTED_BYTES / 3) * 4 + ENVELOPE_PREFIX.length +
  KEY_ID_HEX_LENGTH + 1;
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
// A JSON array containing one-character values needs two bytes per value once
// separators are included. Bounding the traversal before cloning therefore
// prevents sparse arrays or deeply nested metadata from consuming memory
// before the final plaintext-size check can run.
const MAX_JSON_VALUE_COUNT = Math.floor((MAX_PLAINTEXT_BYTES + 1) / 2);
const MAX_JSON_NESTING_DEPTH = 64;

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
  try {
    if (typeof process !== "undefined" && process.env) return process.env[name];
  } catch {
    // Deno exposes the Node-compatible `process` global even when env access
    // is denied. Treat that denial as an unavailable value; never bypass it
    // through a second environment API.
    return undefined;
  }
  try {
    return (globalThis as { Deno?: { env?: { get?: (name: string) => string | undefined } } })
      .Deno?.env?.get?.(name);
  } catch {
    return undefined;
  }
}

/** Generate a fresh 256-bit key encoded as 64 hex characters. */
export function generateEncryptionKey(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(AES_KEY_BYTES)))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function parseEncryptionKeyHex(keyHex: string, envVar: string): Uint8Array<ArrayBuffer> {
  if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) {
    throw new TypeError(
      `${envVar} must be exactly 64 hexadecimal characters ` +
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
  return parseEncryptionKeyHex(configured, ENCRYPTION_KEY_ENV_VAR);
}

/**
 * Resolve the decryption key ring: the current key first (used for every
 * new write), then the optional previous key kept readable during rotation.
 */
function resolveEncryptionKeyRing(): Uint8Array<ArrayBuffer>[] {
  const ring = [requireEncryptionKeyBytes()];
  const previous = readEnvironmentVariable(PREVIOUS_ENCRYPTION_KEY_ENV_VAR);
  if (previous !== undefined && previous !== "") {
    ring.push(parseEncryptionKeyHex(previous, PREVIOUS_ENCRYPTION_KEY_ENV_VAR));
  }
  return ring;
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

function quoteJsonString(value: string): string {
  let quoted = '"';
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    switch (code) {
      case 0x08:
        quoted += "\\b";
        break;
      case 0x09:
        quoted += "\\t";
        break;
      case 0x0a:
        quoted += "\\n";
        break;
      case 0x0c:
        quoted += "\\f";
        break;
      case 0x0d:
        quoted += "\\r";
        break;
      case 0x22:
        quoted += '\\"';
        break;
      case 0x5c:
        quoted += "\\\\";
        break;
      default:
        if (code <= 0x1f) {
          quoted += "\\u" + code.toString(16).padStart(4, "0");
        } else if (code >= 0xd800 && code <= 0xdbff) {
          const next = value.charCodeAt(index + 1);
          if (next >= 0xdc00 && next <= 0xdfff) {
            quoted += value[index]! + value[index + 1]!;
            index++;
          } else {
            quoted += "\\u" + code.toString(16).padStart(4, "0");
          }
        } else if (code >= 0xdc00 && code <= 0xdfff) {
          quoted += "\\u" + code.toString(16).padStart(4, "0");
        } else {
          quoted += value[index];
        }
    }
  }
  return quoted + '"';
}

function jsonArrayFrame(values: readonly string[]): string {
  return "[" + values.map(quoteJsonString).join(",") + "]";
}

function tokensStorageKey(serviceId: string, userId: string): string {
  return TOKENS_KEY_PREFIX + jsonArrayFrame([
    requireKeyComponent(serviceId, "serviceId"),
    requireKeyComponent(userId, "userId"),
  ]);
}

function refreshLockKey(serviceId: string, userId: string): string {
  return REFRESH_LOCK_KEY_PREFIX + jsonArrayFrame([
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
  return STATE_KEY_PREFIX + jsonArrayFrame([state]);
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

interface JsonTraversalState {
  ancestors: WeakSet<object>;
  depth: number;
  remainingStringCodeUnits: number;
  remainingValues: number;
}

function createJsonTraversalState(): JsonTraversalState {
  return {
    ancestors: new WeakSet(),
    depth: 0,
    remainingStringCodeUnits: MAX_PLAINTEXT_BYTES,
    remainingValues: MAX_JSON_VALUE_COUNT,
  };
}

function consumeJsonStringBudget(
  state: JsonTraversalState,
  value: string,
  label: string,
): void {
  if (value.length > state.remainingStringCodeUnits) {
    throw new RangeError(`${label} contains too much JSON string data`);
  }
  state.remainingStringCodeUnits -= value.length;
}

function snapshotJsonData(
  value: unknown,
  label: string,
  state = createJsonTraversalState(),
): unknown {
  if (state.remainingValues === 0) {
    throw new RangeError(`${label} contains too many JSON values`);
  }
  state.remainingValues--;

  if (value === null || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    consumeJsonStringBudget(state, value, label);
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${label} must contain only finite JSON numbers`);
    }
    return value;
  }
  if (!value || typeof value !== "object") {
    throw new TypeError(`${label} must contain only JSON data values`);
  }
  if (state.depth >= MAX_JSON_NESTING_DEPTH) {
    throw new RangeError(
      `${label} exceeds the maximum JSON nesting depth of ${MAX_JSON_NESTING_DEPTH}`,
    );
  }
  if (state.ancestors.has(value)) {
    throw new TypeError(`${label} must not contain cyclic JSON data`);
  }
  state.ancestors.add(value);
  state.depth++;

  try {
    if (Array.isArray(value)) {
      if (value.length > state.remainingValues) {
        throw new RangeError(`${label} contains too many JSON values`);
      }
      const snapshot: unknown[] = [];
      snapshot.length = value.length;
      for (let index = 0; index < value.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !("value" in descriptor)) {
          throw new TypeError(`${label} must contain only own data values`);
        }
        Object.defineProperty(snapshot, String(index), {
          configurable: true,
          enumerable: true,
          value: snapshotJsonData(descriptor.value, label, state),
          writable: true,
        });
      }
      Object.defineProperty(snapshot, "toJSON", {
        configurable: true,
        enumerable: false,
        value: undefined,
      });
      return snapshot;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`${label} must contain only plain JSON data objects`);
    }
    const keys = Object.keys(value);
    if (keys.length > state.remainingValues) {
      throw new RangeError(`${label} contains too many JSON values`);
    }
    const snapshot: Record<string, unknown> = Object.create(null);
    for (const key of keys) {
      consumeJsonStringBudget(state, key, label);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor)) {
        throw new TypeError(`${label} must contain only own data values`);
      }
      snapshot[key] = snapshotJsonData(descriptor.value, label, state);
    }
    return snapshot;
  } finally {
    state.depth--;
    state.ancestors.delete(value);
  }
}

function stringifyJsonData(value: unknown): string {
  return JSON.stringify(snapshotJsonData(value, "Stored OAuth value"));
}

function requireMetadata(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Stored OAuth state metadata must be a plain object");
  }
  return snapshotJsonData(value, "Stored OAuth state metadata") as Record<string, unknown>;
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
  const scopeSource = ownDataValue(value, "scopeSource");
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
    scopeSource !== undefined && scopeSource !== "default" && scopeSource !== "explicit"
  ) {
    throw new TypeError("OAuth token row scopeSource must be default or explicit");
  }
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
    ...(scopeSource === undefined ? {} : { scopeSource: scopeSource as OAuthScopeSource }),
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
  const scopeSource = ownDataValue(value, "scopeSource");
  const metadata = requireMetadata(ownDataValue(value, "metadata"));
  if (
    typeof userId !== "string" || userId.length === 0 ||
    userId.length > MAX_KEY_COMPONENT_LENGTH || userId.trim() !== userId ||
    hasAsciiControlCharacter(userId)
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
    scopeSource !== undefined && scopeSource !== "default" && scopeSource !== "explicit"
  ) {
    throw new TypeError("Stored OAuth state row scopeSource must be default or explicit");
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
    ...(scopeSource === undefined ? {} : { scopeSource: scopeSource as OAuthScopeSource }),
    ...(metadata === undefined ? {} : { metadata }),
  };
}

function isFreshState(createdAt: number, now: number): boolean {
  if (createdAt > now) {
    return createdAt - now <= STATE_CLOCK_SKEW_MS;
  }
  return now - createdAt <= STATE_TTL_MS;
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

interface EnvelopeKey {
  /** First 8 bytes of SHA-256 over the raw key, hex-encoded. */
  keyId: string;
  key: CryptoKey;
}

async function importEnvelopeKey(keyBytes: Uint8Array<ArrayBuffer>): Promise<EnvelopeKey> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", keyBytes));
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
  keyBytes.fill(0);
  const keyId = Array.from(digest.subarray(0, KEY_ID_HEX_LENGTH / 2))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return { keyId, key };
}

interface OpenedEnvelope {
  value: unknown;
  /**
   * False when the row was decrypted with a retiring key or arrived in a
   * legacy v1 envelope, i.e. re-sealing it with the current key lets
   * `TOKEN_ENCRYPTION_KEY_PREVIOUS` be dropped sooner.
   */
  sealedWithCurrentKey: boolean;
}

class EnvelopeCipher {
  /** The first entry is the current key; every entry may decrypt. */
  readonly #keys: Promise<EnvelopeKey[]>;

  constructor(keyRing: readonly Uint8Array<ArrayBuffer>[]) {
    this.#keys = Promise.all(keyRing.map(importEnvelopeKey));
  }

  async seal(storageKey: string, value: unknown): Promise<string> {
    const plaintext = new TextEncoder().encode(stringifyJsonData(value));
    if (plaintext.byteLength > MAX_PLAINTEXT_BYTES) {
      throw new RangeError(`Stored OAuth value exceeds ${MAX_PLAINTEXT_BYTES} bytes`);
    }
    const [current] = await this.#keys;
    if (!current) {
      throw new Error("Encrypted token store has no encryption key configured");
    }
    const iv = crypto.getRandomValues(new Uint8Array(AES_GCM_IV_BYTES));
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(storageKey) },
        current.key,
        plaintext,
      ),
    );
    const combined = new Uint8Array(iv.byteLength + ciphertext.byteLength);
    combined.set(iv);
    combined.set(ciphertext, iv.byteLength);
    return ENVELOPE_PREFIX + current.keyId + ":" + bytesToBase64(combined);
  }

  async open(storageKey: string, stored: string): Promise<OpenedEnvelope> {
    if (typeof stored !== "string" || stored.length > MAX_ENCODED_LENGTH) {
      throw new TypeError("Stored OAuth value must be a bounded string");
    }
    const keys = await this.#keys;
    if (stored.startsWith(ENVELOPE_PREFIX)) {
      const body = stored.slice(ENVELOPE_PREFIX.length);
      const keyId = body.slice(0, KEY_ID_HEX_LENGTH);
      if (!KEY_ID_PATTERN.test(keyId) || body[KEY_ID_HEX_LENGTH] !== ":") {
        throw new TypeError("Encrypted OAuth value has a malformed key id");
      }
      const match = keys.find((entry) => entry.keyId === keyId);
      if (!match) {
        throw new Error(
          `Encrypted OAuth value was sealed with an unknown encryption key (id ${keyId}). ` +
            `Set ${PREVIOUS_ENCRYPTION_KEY_ENV_VAR} to the retiring key during rotation, ` +
            "or re-authenticate affected users.",
        );
      }
      return {
        value: await this.#decrypt(
          storageKey,
          base64ToBytes(body.slice(KEY_ID_HEX_LENGTH + 1)),
          match.key,
        ),
        sealedWithCurrentKey: match === keys[0],
      };
    }
    if (stored.startsWith(LEGACY_ENVELOPE_PREFIX)) {
      // v1 envelopes carry no key id, so try every configured key. They are
      // never reported as current: re-sealing upgrades them to v2.
      const combined = base64ToBytes(stored.slice(LEGACY_ENVELOPE_PREFIX.length));
      let lastFailure: unknown;
      for (const entry of keys) {
        try {
          return {
            value: await this.#decrypt(storageKey, combined, entry.key),
            sealedWithCurrentKey: false,
          };
        } catch (failure) {
          lastFailure = failure;
        }
      }
      throw lastFailure;
    }
    throw new Error(
      "Stored OAuth value is not in a vf-aes-gcm envelope format. This store " +
        "never reads plaintext credentials; re-authenticate affected users to " +
        "replace legacy rows.",
    );
  }

  async #decrypt(
    storageKey: string,
    combined: Uint8Array<ArrayBuffer>,
    key: CryptoKey,
  ): Promise<unknown> {
    const iv = combined.subarray(0, AES_GCM_IV_BYTES);
    const ciphertext = combined.subarray(AES_GCM_IV_BYTES);
    let plaintext: ArrayBuffer;
    try {
      plaintext = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(storageKey) },
        key,
        ciphertext,
      );
    } catch (cause) {
      throw new Error(
        "Encrypted OAuth value failed authentication (wrong key, corrupted " +
          "data, or a value moved between storage slots)",
        { cause },
      );
    }
    try {
      return JSON.parse(new TextDecoder().decode(plaintext));
    } catch (cause) {
      throw new Error("Encrypted OAuth value contains invalid JSON", { cause });
    }
  }
}

function unreadableTokenRowReason(failure: unknown): string {
  if (!(failure instanceof Error)) return "malformed encrypted row";
  if (failure.message.includes("unknown encryption key")) return "unknown encryption key";
  if (failure.message.includes("failed authentication")) return "failed authentication";
  return "malformed encrypted row";
}

function unreadableStateRowReason(failure: unknown): string {
  if (!(failure instanceof Error)) return "malformed encrypted state row";
  if (failure.message.includes("unknown encryption key")) return "unknown encryption key";
  if (failure.message.includes("failed authentication")) return "failed authentication";
  return "malformed encrypted state row";
}

function assertRotationScanBackend(
  backend: EncryptedKvRotationScanBackend,
): asserts backend is EncryptedKvRotationScanBackend {
  assertBackend(backend);
  if (typeof backend.scan !== "function") {
    throw new TypeError("Encrypted token store rotation checks require backend.scan()");
  }
}

/**
 * Count token and OAuth state rows that still require
 * `TOKEN_ENCRYPTION_KEY_PREVIOUS`.
 *
 * Run this after rotating keys and after normal reconnect/refresh traffic has
 * had a chance to rewrite rows. When `complete` is true, the scanned rows no
 * longer require the previous key. Unreadable rows are counted separately and
 * should be cleared or replaced before removing the previous key.
 * Expired OAuth state rows are ignored after authenticated decrypt and schema
 * validation because they can no longer be consumed.
 * `complete` describes only rows yielded by the backend; an empty scan reports
 * `complete: true` with `scannedRows: 0`. Confirm the scan covered the expected
 * rows before removing the previous key.
 */
export async function checkEncryptedTokenStoreRotation(
  backend: EncryptedKvRotationScanBackend,
): Promise<EncryptedTokenStoreRotationReport> {
  assertRotationScanBackend(backend);
  const cipher = new EnvelopeCipher(resolveEncryptionKeyRing());
  const report: EncryptedTokenStoreRotationReport = {
    scannedRows: 0,
    currentKeyRows: 0,
    previousKeyRows: 0,
    unreadableRows: 0,
    complete: false,
  };
  const scanNow = Date.now();

  for (const prefix of [TOKENS_KEY_PREFIX, STATE_KEY_PREFIX]) {
    for await (const row of backend.scan(prefix)) {
      report.scannedRows++;
      if (
        !row || typeof row !== "object" || typeof row.key !== "string" ||
        typeof row.value !== "string" || !row.key.startsWith(prefix)
      ) {
        report.unreadableRows++;
        continue;
      }
      try {
        const opened = await cipher.open(row.key, row.value);
        if (row.key.startsWith(TOKENS_KEY_PREFIX)) {
          requireTokenEntry(opened.value);
        } else {
          const state = requireStateRow(opened.value);
          if (!isFreshState(state.createdAt, scanNow)) continue;
        }
        if (opened.sealedWithCurrentKey) report.currentKeyRows++;
        else report.previousKeyRows++;
      } catch {
        report.unreadableRows++;
      }
    }
  }

  report.complete = report.previousKeyRows === 0 && report.unreadableRows === 0;
  return report;
}

/**
 * Build a `RefreshCapableTokenStore` over a durable key-value backend with
 * AES-256-GCM encryption at rest.
 *
 * Fails closed at creation time when `TOKEN_ENCRYPTION_KEY` is missing or
 * malformed, and when the backend does not provide the atomic operations
 * that safe multi-worker refresh requires.
 *
 * Wire it once during startup through an explicit configuration boundary:
 *
 * ```ts
 * import { configureTokenStore } from "./token-store.ts";
 * import {
 *   createEncryptedTokenStore,
 *   type EncryptedKvBackend,
 * } from "./encrypted-token-store.ts";
 *
 * export function configureOAuthStorage(backend: EncryptedKvBackend): void {
 *   configureTokenStore(createEncryptedTokenStore(backend));
 * }
 * ```
 */
export function createEncryptedTokenStore(
  backend: EncryptedKvBackend,
): RefreshCapableTokenStore {
  assertBackend(backend);
  const cipher = new EnvelopeCipher(resolveEncryptionKeyRing());

  // Undecryptable or malformed rows degrade to "absent" instead of failing
  // the caller: a single bad row must not take down an integrations page.
  // The integration shows as disconnected and reconnecting (setTokens)
  // overwrites the row; clearTokens removes it explicitly. The warning never
  // includes token material.
  async function readTokenEntry(
    serviceId: string,
    userId: string,
  ): Promise<{ key: string; raw: string; entry: StoredTokenEntry } | null> {
    const key = tokensStorageKey(serviceId, userId);
    const raw = await backend.get(key);
    if (raw === null) return null;
    try {
      const opened = await cipher.open(key, raw);
      const entry = requireTokenEntry(opened.value);
      if (opened.sealedWithCurrentKey) return { key, raw, entry };
      return { key, raw: (await resealTokenRow(key, raw, entry)) ?? raw, entry };
    } catch (failure) {
      console.warn(
        "[Encrypted Token Store] Ignoring unreadable OAuth token row " +
          `(${unreadableTokenRowReason(failure)}). ` +
          "The integration is reported as disconnected; reconnecting overwrites the row.",
      );
      return null;
    }
  }

  // Best-effort transparent re-seal so rotation also converges for rows that
  // are read but never rewritten. The revision is preserved (this is a
  // re-encryption, not a logical write), the swap is ABA-safe because every
  // seal uses a fresh IV, and any failure is ignored: the next read simply
  // tries again, and losing the swap to a concurrent writer is fine because
  // that writer already sealed with the current key.
  async function resealTokenRow(
    key: string,
    raw: string,
    entry: StoredTokenEntry,
  ): Promise<string | null> {
    try {
      const resealed = await cipher.seal(key, entry);
      return (await backend.compareAndSwap(key, raw, resealed)) ? resealed : null;
    } catch {
      return null;
    }
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

    async compareAndClearTokens(
      serviceId: string,
      userId: string,
      expectedRevision: string,
    ): Promise<boolean> {
      if (typeof expectedRevision !== "string" || expectedRevision.length === 0) {
        throw new TypeError("Expected OAuth token revision must be a non-empty string");
      }
      const current = await readTokenEntry(serviceId, userId);
      if (!current || current.entry.revision !== expectedRevision) return false;
      return backend.compareAndSwap(current.key, current.raw, null);
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
        const row = requireStateRow((await cipher.open(key, raw)).value);
        return isFreshState(row.createdAt, Date.now()) ? row : null;
      } catch (failure) {
        console.warn(
          "[Encrypted Token Store] Ignoring unreadable OAuth state row " +
            `(${unreadableStateRowReason(failure)}). ` +
            "The OAuth callback state is rejected.",
        );
        return null;
      }
    },
  };
}

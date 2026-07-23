/********************************************************************************
 * Legacy Credential Store
 *
 * This small store remains for connector templates that have not migrated to
 * the `ApplicationOAuthTokenStore` contract in `oauth-store-registry.ts`.
 * OAuth 2.0 routes and clients must use that application contract instead.
 *
 * Development defaults to process-local memory. Production must explicitly
 * inject a durable backend with `createTokenStore`; no backend is selected from
 * environment-variable names and no in-memory production fallback exists.
 ********************************************************************************/

import { readEnvironmentVariable } from "./environment.ts";

export interface OAuthToken {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  tokenType?: string;
  scope?: string;
}

export interface TokenStore {
  getToken(userId: string, service: string): Promise<OAuthToken | null>;
  setToken(userId: string, service: string, token: OAuthToken): Promise<void>;
  revokeToken(userId: string, service: string): Promise<void>;
  isConnected(userId: string, service: string): Promise<boolean>;
}

export interface TokenStoreConfig {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string) => Promise<void>;
  delete: (key: string) => Promise<void>;
  /**
   * Explicitly migrate the old `userId:service` key after a successful read.
   * Migration is attempted only when neither component contains `:`, because
   * only then is the legacy tuple mapping unambiguous.
   */
  legacyColonKeyMigration?: "read-delete";
}

const TOKEN_KEY_PREFIX = "veryfront:credential:v2:";
const TOKENS_KEY = "__veryfront_credential_tokens_v2__";
const ENCRYPTED_PREFIX = "encrypted:";
const AES_GCM_IV_BYTES = 12;
const AES_GCM_TAG_BYTES = 16;
const MAX_KEY_COMPONENT_LENGTH = 1024;
const MAX_TOKEN_VALUE_BYTES = 256 * 1024;
const MAX_TOKEN_FIELD_LENGTH = 128 * 1024;
const MAX_METADATA_FIELD_LENGTH = 16 * 1024;
const MAX_ENCRYPTED_BYTES = MAX_TOKEN_VALUE_BYTES + AES_GCM_IV_BYTES +
  AES_GCM_TAG_BYTES;
const MAX_ENCODED_BYTES = Math.ceil(MAX_ENCRYPTED_BYTES / 3) * 4;
const BASE64_CHUNK_BYTES = 0x8000;

const globalStore = globalThis as Record<string, unknown>;

function assertKeyComponent(value: string, label: string): string {
  if (
    typeof value !== "string" || value.length === 0 ||
    value.length > MAX_KEY_COMPONENT_LENGTH ||
    value.trim() !== value
  ) {
    throw new TypeError(
      `${label} must be a trimmed, non-empty string of at most ${MAX_KEY_COMPONENT_LENGTH} characters`,
    );
  }
  return value;
}

/** Build a bounded, collision-free storage key for one user/service tuple. */
export function buildTokenStorageKey(userId: string, service: string): string {
  return TOKEN_KEY_PREFIX + JSON.stringify([
    assertKeyComponent(userId, "userId"),
    assertKeyComponent(service, "service"),
  ]);
}

function getSafeLegacyKey(userId: string, service: string): string | null {
  const normalizedUserId = assertKeyComponent(userId, "userId");
  const normalizedService = assertKeyComponent(service, "service");
  return normalizedUserId.includes(":") || normalizedService.includes(":")
    ? null
    : `${normalizedUserId}:${normalizedService}`;
}

function normalizeBoundedString(
  value: unknown,
  label: string,
  maxLength: number,
  required: boolean,
): string | undefined {
  if (value === undefined && !required) return undefined;
  if (
    typeof value !== "string" || value.length === 0 ||
    value.length > maxLength ||
    value.trim() !== value
  ) {
    throw new TypeError(`${label} must be a trimmed, non-empty bounded string`);
  }
  return value;
}

function normalizeToken(value: unknown): OAuthToken {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Stored credential must be an object");
  }

  const candidate = value as Record<string, unknown>;
  const allowed = new Set([
    "accessToken",
    "refreshToken",
    "expiresAt",
    "tokenType",
    "scope",
  ]);
  if (Object.keys(candidate).some((key) => !allowed.has(key))) {
    throw new TypeError("Stored credential contains unsupported fields");
  }

  const accessToken = normalizeBoundedString(
    candidate.accessToken,
    "accessToken",
    MAX_TOKEN_FIELD_LENGTH,
    true,
  )!;
  const refreshToken = normalizeBoundedString(
    candidate.refreshToken,
    "refreshToken",
    MAX_TOKEN_FIELD_LENGTH,
    false,
  );
  const tokenType = normalizeBoundedString(
    candidate.tokenType,
    "tokenType",
    MAX_METADATA_FIELD_LENGTH,
    false,
  );
  const scope = normalizeBoundedString(
    candidate.scope,
    "scope",
    MAX_METADATA_FIELD_LENGTH,
    false,
  );
  const expiresAt = candidate.expiresAt;
  if (
    expiresAt !== undefined &&
    (typeof expiresAt !== "number" || !Number.isSafeInteger(expiresAt) ||
      expiresAt < 0)
  ) {
    throw new TypeError("expiresAt must be a non-negative safe integer");
  }

  return {
    accessToken,
    ...(refreshToken === undefined ? {} : { refreshToken }),
    ...(expiresAt === undefined ? {} : { expiresAt }),
    ...(tokenType === undefined ? {} : { tokenType }),
    ...(scope === undefined ? {} : { scope }),
  };
}

function serializeToken(token: OAuthToken): Uint8Array<ArrayBuffer> {
  const normalized = normalizeToken(token);
  const data = new TextEncoder().encode(JSON.stringify(normalized));
  if (data.byteLength > MAX_TOKEN_VALUE_BYTES) {
    throw new RangeError(
      `Stored credential exceeds ${MAX_TOKEN_VALUE_BYTES} bytes`,
    );
  }
  return data;
}

function parseTokenJson(value: string): OAuthToken {
  const bytes = new TextEncoder().encode(value);
  if (bytes.byteLength > MAX_TOKEN_VALUE_BYTES) {
    throw new RangeError(
      `Stored credential exceeds ${MAX_TOKEN_VALUE_BYTES} bytes`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (cause) {
    throw new TypeError("Stored credential is not valid JSON", { cause });
  }
  return normalizeToken(parsed);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (
    let offset = 0;
    offset < bytes.byteLength;
    offset += BASE64_CHUNK_BYTES
  ) {
    const chunk = bytes.subarray(offset, offset + BASE64_CHUNK_BYTES);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function base64ToBytes(encoded: string): Uint8Array<ArrayBuffer> {
  if (
    encoded.length === 0 || encoded.length > MAX_ENCODED_BYTES ||
    encoded.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)
  ) {
    throw new TypeError("Encrypted credential has invalid base64 encoding");
  }

  let binary: string;
  try {
    binary = atob(encoded);
  } catch (cause) {
    throw new TypeError("Encrypted credential has invalid base64 encoding", {
      cause,
    });
  }
  if (
    binary.length < AES_GCM_IV_BYTES + AES_GCM_TAG_BYTES ||
    binary.length > MAX_ENCRYPTED_BYTES
  ) {
    throw new RangeError("Encrypted credential has an invalid size");
  }

  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function hexToKeyBytes(keyHex: string): Uint8Array<ArrayBuffer> {
  if (!/^[\da-f]{64}$/i.test(keyHex)) {
    throw new TypeError(
      "TOKEN_ENCRYPTION_KEY must be exactly 64 hexadecimal characters (32 bytes)",
    );
  }

  const key = new Uint8Array(32);
  for (let index = 0; index < key.length; index++) {
    key[index] = Number.parseInt(keyHex.slice(index * 2, index * 2 + 2), 16);
  }
  return key;
}

/** Return null only when encryption was not configured at all. */
function getEncryptionKey(): Uint8Array<ArrayBuffer> | null {
  const configured = readEnvironmentVariable("TOKEN_ENCRYPTION_KEY");
  return configured === undefined ? null : hexToKeyBytes(configured);
}

export async function encryptToken(token: OAuthToken): Promise<string> {
  const data = serializeToken(token);
  const key = getEncryptionKey();
  if (!key) return new TextDecoder().decode(data);

  const iv = crypto.getRandomValues(new Uint8Array(AES_GCM_IV_BYTES));
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, cryptoKey, data),
  );
  const combined = new Uint8Array(iv.byteLength + ciphertext.byteLength);
  combined.set(iv);
  combined.set(ciphertext, iv.byteLength);
  return ENCRYPTED_PREFIX + bytesToBase64(combined);
}

export async function decryptToken(value: string): Promise<OAuthToken> {
  if (typeof value !== "string") {
    throw new TypeError("Stored credential must be a string");
  }

  const key = getEncryptionKey();
  if (!value.startsWith(ENCRYPTED_PREFIX)) {
    if (key) {
      throw new Error(
        "Refusing plaintext credential because TOKEN_ENCRYPTION_KEY is configured",
      );
    }
    return parseTokenJson(value);
  }
  if (!key) {
    throw new Error("Cannot decrypt credential without TOKEN_ENCRYPTION_KEY");
  }

  const combined = base64ToBytes(value.slice(ENCRYPTED_PREFIX.length));
  const iv = combined.subarray(0, AES_GCM_IV_BYTES);
  const ciphertext = combined.subarray(AES_GCM_IV_BYTES);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    "AES-GCM",
    false,
    ["decrypt"],
  );

  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      cryptoKey,
      ciphertext,
    );
  } catch (cause) {
    throw new Error("Encrypted credential failed authentication", { cause });
  }
  if (plaintext.byteLength > MAX_TOKEN_VALUE_BYTES) {
    throw new RangeError(
      `Stored credential exceeds ${MAX_TOKEN_VALUE_BYTES} bytes`,
    );
  }
  return parseTokenJson(new TextDecoder().decode(plaintext));
}

export function generateEncryptionKey(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export type StorageMode = "memory" | "custom";

export function getStorageMode(): StorageMode {
  return "memory";
}

export function isEncryptionEnabled(): boolean {
  return getEncryptionKey() !== null;
}

function isProductionRuntime(): boolean {
  return readEnvironmentVariable("NODE_ENV") === "production";
}

const tokens =
  (globalStore[TOKENS_KEY] as Map<string, OAuthToken> | undefined) ??
    new Map<string, OAuthToken>();
globalStore[TOKENS_KEY] = tokens;

async function isConnected(
  store: Pick<TokenStore, "getToken">,
  userId: string,
  service: string,
): Promise<boolean> {
  const token = await store.getToken(userId, service);
  if (!token) return false;
  return token.expiresAt === undefined || token.expiresAt > Date.now() ||
    !!token.refreshToken;
}

const inMemoryStore: TokenStore = {
  getToken(userId, service) {
    const token = tokens.get(buildTokenStorageKey(userId, service));
    return Promise.resolve(token ? { ...token } : null);
  },
  setToken(userId, service, token) {
    tokens.set(buildTokenStorageKey(userId, service), normalizeToken(token));
    return Promise.resolve();
  },
  revokeToken(userId, service) {
    tokens.delete(buildTokenStorageKey(userId, service));
    return Promise.resolve();
  },
  isConnected(userId, service) {
    return isConnected(this, userId, service);
  },
};

export function createTokenStore(config: TokenStoreConfig): TokenStore {
  return {
    async getToken(userId, service) {
      const key = buildTokenStorageKey(userId, service);
      const current = await config.get(key);
      if (current !== null) return await decryptToken(current);

      if (config.legacyColonKeyMigration !== "read-delete") return null;
      const legacyKey = getSafeLegacyKey(userId, service);
      if (!legacyKey) return null;
      const legacy = await config.get(legacyKey);
      if (legacy === null) return null;

      const token = await decryptToken(legacy);
      await config.set(key, await encryptToken(token));
      await config.delete(legacyKey);
      return token;
    },
    async setToken(userId, service, token) {
      await config.set(
        buildTokenStorageKey(userId, service),
        await encryptToken(token),
      );
    },
    async revokeToken(userId, service) {
      await config.delete(buildTokenStorageKey(userId, service));
      if (config.legacyColonKeyMigration === "read-delete") {
        const legacyKey = getSafeLegacyKey(userId, service);
        if (legacyKey) await config.delete(legacyKey);
      }
    },
    isConnected(userId, service) {
      return isConnected(this, userId, service);
    },
  };
}

export function createDefaultTokenStore(): TokenStore {
  if (isProductionRuntime()) {
    throw new Error(
      "In-memory credential storage is not allowed in production. Inject an application-owned durable store explicitly.",
    );
  }
  return inMemoryStore;
}

let defaultTokenStore: TokenStore | null = null;

function getDefaultTokenStore(): TokenStore {
  defaultTokenStore ??= createDefaultTokenStore();
  return defaultTokenStore;
}

export const tokenStore: TokenStore = {
  getToken(userId, service) {
    return getDefaultTokenStore().getToken(userId, service);
  },
  setToken(userId, service, token) {
    return getDefaultTokenStore().setToken(userId, service, token);
  },
  revokeToken(userId, service) {
    return getDefaultTokenStore().revokeToken(userId, service);
  },
  isConnected(userId, service) {
    return getDefaultTokenStore().isConnected(userId, service);
  },
};

if (!isProductionRuntime()) {
  console.warn(
    "[Credential Store] Using process-local memory for development; values are lost on restart.",
  );
}

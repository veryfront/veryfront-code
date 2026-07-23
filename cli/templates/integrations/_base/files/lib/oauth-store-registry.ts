import type { TokenStore } from "veryfront/oauth";

export const OAUTH_STORAGE_MODES = [
  "memory",
  "database",
  "kv",
  "redis",
  "custom",
] as const;

export type OAuthStorageMode = (typeof OAUTH_STORAGE_MODES)[number];

/** Capabilities reported by the installed adapter itself, never inferred. */
export interface OAuthStorageStatus {
  mode: OAuthStorageMode;
  durable: boolean;
  /** `null` means the adapter cannot attest to encryption at rest. */
  encrypted: boolean | null;
}

/**
 * Production OAuth storage contract used by every generated OAuth route and
 * API client. The three refresh methods are optional on the upstream
 * source-compatible type, but generated applications require them so refresh
 * is revisioned, atomic, and serialized across workers.
 */
export type ApplicationOAuthTokenStore =
  & TokenStore
  & Required<
    Pick<
      TokenStore,
      "getTokenSnapshot" | "compareAndSetTokens" | "withTokenRefreshLock"
    >
  >
  & {
    getStorageStatus(): OAuthStorageStatus;
  };

const OAUTH_STORE_KEY = Symbol.for("veryfront.application.oauth-token-store");
const registry = globalThis as unknown as Record<PropertyKey, unknown>;

const REQUIRED_METHODS = [
  "getTokens",
  "setTokens",
  "clearTokens",
  "getTokenSnapshot",
  "compareAndSetTokens",
  "withTokenRefreshLock",
  "setState",
  "consumeState",
  "getStorageStatus",
] as const;

function isOAuthStorageMode(value: unknown): value is OAuthStorageMode {
  return typeof value === "string" &&
    (OAUTH_STORAGE_MODES as readonly string[]).includes(value);
}

function normalizeOAuthStorageStatus(value: unknown): OAuthStorageStatus {
  if (!value || typeof value !== "object") {
    throw new TypeError("OAuth TokenStore storage status must be an object");
  }

  const candidate = value as Record<string, unknown>;
  if (!isOAuthStorageMode(candidate.mode)) {
    throw new TypeError(
      `OAuth TokenStore storage mode must be one of: ${
        OAUTH_STORAGE_MODES.join(", ")
      }`,
    );
  }
  if (typeof candidate.durable !== "boolean") {
    throw new TypeError("OAuth TokenStore durable status must be a boolean");
  }
  if (
    candidate.encrypted !== null && typeof candidate.encrypted !== "boolean"
  ) {
    throw new TypeError(
      "OAuth TokenStore encrypted status must be a boolean or null",
    );
  }

  return {
    mode: candidate.mode,
    durable: candidate.durable,
    encrypted: candidate.encrypted,
  };
}

function assertApplicationOAuthTokenStore(
  value: unknown,
): asserts value is ApplicationOAuthTokenStore {
  if (!value || (typeof value !== "object" && typeof value !== "function")) {
    throw new TypeError("OAuth TokenStore must be an object");
  }

  const candidate = value as Record<string, unknown>;
  for (const method of REQUIRED_METHODS) {
    if (typeof candidate[method] !== "function") {
      throw new TypeError(`OAuth TokenStore must implement ${method}()`);
    }
  }
}

/**
 * Install the application's durable OAuth store during process startup.
 *
 * Import this registry (not `oauth-store.ts`) from framework instrumentation,
 * construct one shared Redis/Postgres/etc. adapter, and install it before any
 * OAuth route module is loaded. Implementations must provide:
 *
 * - atomic, one-shot state consumption;
 * - a fresh opaque revision for every token write;
 * - atomic compare-and-set by revision; and
 * - a bounded, crash-recoverable distributed refresh lease; and
 * - truthful storage capability reporting from `getStorageStatus()`.
 */
export function installOAuthTokenStore(
  store: ApplicationOAuthTokenStore,
): void {
  assertApplicationOAuthTokenStore(store);
  const status = readOAuthStorageStatus(store);
  if (!status.durable) {
    throw new TypeError(
      "Installed OAuth TokenStore must report durable storage",
    );
  }
  const existing = registry[OAUTH_STORE_KEY];
  if (existing !== undefined && existing !== store) {
    throw new Error("OAuth TokenStore has already been installed");
  }
  registry[OAUTH_STORE_KEY] = store;
}

/** Return the installed application store without selecting a fallback. */
export function getInstalledOAuthTokenStore():
  | ApplicationOAuthTokenStore
  | null {
  const store = registry[OAUTH_STORE_KEY];
  if (store === undefined) return null;
  assertApplicationOAuthTokenStore(store);
  return store;
}

/** Read and validate capabilities reported by the installed adapter. */
export function readOAuthStorageStatus(
  store: ApplicationOAuthTokenStore,
): OAuthStorageStatus {
  return normalizeOAuthStorageStatus(store.getStorageStatus());
}

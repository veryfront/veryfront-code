/**
 * Shared OAuth token store for generated integrations.
 *
 * The same store owns authorization state and tokens. This is required for
 * callbacks and token refresh to work across production workers. Configure a
 * durable, extension-owned RefreshCapableTokenStore before the first OAuth
 * request in production. The built-in memory store is development-only.
 *
 * To build that durable store on top of a plain key-value service with
 * AES-256-GCM encryption at rest, see `encrypted-token-store.ts` (reference
 * backends live in `token-store-examples.ts`).
 */

import {
  MemoryTokenStore,
  type OAuthTokens,
  type OAuthTokenSnapshot,
  type RefreshCapableTokenStore,
  type StoredOAuthState,
} from "veryfront/oauth";

export type OAuthToken = OAuthTokens;

/**
 * Application-facing store used by both Veryfront OAuth handlers and the
 * generated integration clients.
 */
export interface TokenStore extends RefreshCapableTokenStore {
  getToken(userId: string, serviceId: string): Promise<OAuthToken | null>;
  setToken(userId: string, serviceId: string, token: OAuthToken): Promise<void>;
  revokeToken(userId: string, serviceId: string): Promise<void>;
  isConnected(userId: string, serviceId: string): Promise<boolean>;
}

const REQUIRED_STORE_METHODS = [
  "getTokens",
  "getTokenSnapshot",
  "setTokens",
  "compareAndSetTokens",
  "withTokenRefreshLock",
  "clearTokens",
  "setState",
  "consumeState",
] as const;

function isProductionRuntime(): boolean {
  if (typeof process !== "undefined") return process.env?.NODE_ENV === "production";
  return (globalThis as { Deno?: { env?: { get?: (name: string) => string | undefined } } }).Deno
    ?.env?.get?.("NODE_ENV") === "production";
}

function assertRefreshCapableStore(
  store: RefreshCapableTokenStore,
): asserts store is RefreshCapableTokenStore {
  if (!store || typeof store !== "object") {
    throw new TypeError("OAuth token store must be an object");
  }

  for (const method of REQUIRED_STORE_METHODS) {
    if (typeof store[method] !== "function") {
      throw new TypeError(`OAuth token store must implement ${method}()`);
    }
  }
}

/**
 * Add the generated client aliases to a production-grade Veryfront OAuth
 * store. The adapter delegates every concurrency and state operation to the
 * supplied store; it never emulates distributed behavior in process memory.
 */
export function createTokenStore(store: RefreshCapableTokenStore): TokenStore {
  assertRefreshCapableStore(store);

  return {
    getTokens(serviceId: string, userId: string): Promise<OAuthTokens | null> {
      return store.getTokens(serviceId, userId);
    },

    getTokenSnapshot(
      serviceId: string,
      userId: string,
    ): Promise<OAuthTokenSnapshot | null> {
      return store.getTokenSnapshot(serviceId, userId);
    },

    setTokens(serviceId: string, userId: string, tokens: OAuthTokens): Promise<void> {
      return store.setTokens(serviceId, userId, tokens);
    },

    compareAndSetTokens(
      serviceId: string,
      userId: string,
      expectedRevision: string,
      tokens: OAuthTokens,
    ): Promise<boolean> {
      return store.compareAndSetTokens(serviceId, userId, expectedRevision, tokens);
    },

    withTokenRefreshLock<T>(
      serviceId: string,
      userId: string,
      operation: () => Promise<T>,
    ): Promise<T> {
      return store.withTokenRefreshLock(serviceId, userId, operation);
    },

    clearTokens(serviceId: string, userId: string): Promise<void> {
      return store.clearTokens(serviceId, userId);
    },

    setState(state: string, metadata: StoredOAuthState): Promise<void> {
      return store.setState(state, metadata);
    },

    consumeState(state: string): Promise<StoredOAuthState | null> {
      return store.consumeState(state);
    },

    getToken(userId: string, serviceId: string): Promise<OAuthToken | null> {
      return store.getTokens(serviceId, userId);
    },

    setToken(userId: string, serviceId: string, token: OAuthToken): Promise<void> {
      return store.setTokens(serviceId, userId, token);
    },

    revokeToken(userId: string, serviceId: string): Promise<void> {
      return store.clearTokens(serviceId, userId);
    },

    async isConnected(userId: string, serviceId: string): Promise<boolean> {
      const token = await store.getTokens(serviceId, userId);
      return !!token && (token.expiresAt === undefined || token.expiresAt > Date.now());
    },
  };
}

let configuredTokenStore: TokenStore | null = null;
let defaultTokenStore: TokenStore | null = null;

/**
 * Configure the shared production store before the first OAuth request.
 *
 * Production stores must persist state and tokens across workers, implement
 * atomic compare-and-set, and use a bounded, crash-recoverable distributed
 * lease for withTokenRefreshLock(). Storage extensions are responsible for
 * encryption and backend-specific concurrency guarantees.
 */
export function configureTokenStore(store: RefreshCapableTokenStore): void {
  if (configuredTokenStore || defaultTokenStore) {
    throw new Error("OAuth token store must be configured exactly once before first use");
  }
  if (isProductionRuntime() && store instanceof MemoryTokenStore) {
    throw new Error("MemoryTokenStore is not allowed for production OAuth storage");
  }
  configuredTokenStore = createTokenStore(store);
}

/** Resolve the development default without doing work during module import. */
export function createDefaultTokenStore(): TokenStore {
  if (isProductionRuntime()) {
    throw new Error(
      "OAuth token storage is not configured for production. " +
        "Configure an extension-owned RefreshCapableTokenStore with " +
        "configureTokenStore() before the first OAuth request.",
    );
  }

  console.warn(
    "[Token Store] Using development-only in-memory OAuth storage. " +
      "State and tokens will be lost on restart.",
  );
  return createTokenStore(new MemoryTokenStore());
}

function getDefaultTokenStore(): TokenStore {
  defaultTokenStore ??= configuredTokenStore ?? createDefaultTokenStore();
  return defaultTokenStore;
}

/**
 * Lazy proxy shared by every generated OAuth route and integration client.
 * Importing a route never initializes storage or throws.
 */
export const tokenStore: TokenStore = {
  getTokens(serviceId, userId) {
    return getDefaultTokenStore().getTokens(serviceId, userId);
  },
  getTokenSnapshot(serviceId, userId) {
    return getDefaultTokenStore().getTokenSnapshot(serviceId, userId);
  },
  setTokens(serviceId, userId, tokens) {
    return getDefaultTokenStore().setTokens(serviceId, userId, tokens);
  },
  compareAndSetTokens(serviceId, userId, expectedRevision, tokens) {
    return getDefaultTokenStore().compareAndSetTokens(
      serviceId,
      userId,
      expectedRevision,
      tokens,
    );
  },
  withTokenRefreshLock(serviceId, userId, operation) {
    return getDefaultTokenStore().withTokenRefreshLock(serviceId, userId, operation);
  },
  clearTokens(serviceId, userId) {
    return getDefaultTokenStore().clearTokens(serviceId, userId);
  },
  setState(state, metadata) {
    return getDefaultTokenStore().setState(state, metadata);
  },
  consumeState(state) {
    return getDefaultTokenStore().consumeState(state);
  },
  getToken(userId, serviceId) {
    return getDefaultTokenStore().getToken(userId, serviceId);
  },
  setToken(userId, serviceId, token) {
    return getDefaultTokenStore().setToken(userId, serviceId, token);
  },
  revokeToken(userId, serviceId) {
    return getDefaultTokenStore().revokeToken(userId, serviceId);
  },
  isConnected(userId, serviceId) {
    return getDefaultTokenStore().isConnected(userId, serviceId);
  },
};

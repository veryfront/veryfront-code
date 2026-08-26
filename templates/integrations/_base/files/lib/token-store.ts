/**
 * Shared OAuth token store for generated integrations.
 *
 * The same store owns authorization state and tokens. This is required for
 * callbacks and token refresh to work across production workers. Configure a
 * durable, extension-owned RefreshCapableTokenStore before the first OAuth
 * request in production. The built-in memory store is for development and test.
 *
 * To build that durable store on top of a plain key-value service with
 * AES-256-GCM encryption at rest, see `encrypted-token-store.ts` (reference
 * backends live in `token-store-examples.ts`).
 */

import {
  MemoryTokenStore,
  isSupersededOAuthGrant,
  type OAuthTokens,
  type OAuthTokenSnapshot,
  type RefreshCapableTokenStore,
  type StoredOAuthState,
} from "veryfront/oauth";

export type OAuthToken = OAuthTokens;

interface RevisionClearCapableTokenStore extends RefreshCapableTokenStore {
  compareAndClearTokens(
    serviceId: string,
    userId: string,
    expectedRevision: string,
  ): Promise<boolean>;
}

/**
 * Application-facing store used by both Veryfront OAuth handlers and the
 * generated integration clients.
 */
export interface TokenStore extends RevisionClearCapableTokenStore {
  compareAndClearTokens(
    serviceId: string,
    userId: string,
    expectedRevision: string,
  ): Promise<boolean>;
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
  "compareAndClearTokens",
  "withTokenRefreshLock",
  "clearTokens",
  "setState",
  "consumeState",
] as const;
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1_000;

function runtimeMode(): string | undefined {
  try {
    if (typeof process !== "undefined" && process.env) return process.env.NODE_ENV;
  } catch {
    // Deno exposes the Node-compatible `process` global even when env access
    // is denied. Preserve the fail-closed mode decision in that runtime.
    return undefined;
  }
  try {
    return (globalThis as { Deno?: { env?: { get?: (name: string) => string | undefined } } })
      .Deno?.env?.get?.("NODE_ENV");
  } catch {
    return undefined;
  }
}

function allowsProcessLocalStorage(): boolean {
  const mode = runtimeMode();
  return mode === "development" || mode === "test";
}

function assertRefreshCapableStore(
  store: RefreshCapableTokenStore,
): asserts store is RevisionClearCapableTokenStore {
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

    compareAndClearTokens(
      serviceId: string,
      userId: string,
      expectedRevision: string,
    ): Promise<boolean> {
      return store.compareAndClearTokens(serviceId, userId, expectedRevision);
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
      const snapshot = await store.getTokenSnapshot(serviceId, userId);
      if (!snapshot) return false;
      if (isSupersededOAuthGrant(serviceId, snapshot.tokens)) {
        await store.compareAndClearTokens(serviceId, userId, snapshot.revision);
        return false;
      }
      return snapshot.tokens.expiresAt === undefined || snapshot.tokens.expiresAt > Date.now();
    },
  };
}

function unexpiredAccessToken(token: OAuthToken, now = Date.now()): string | null {
  return token.expiresAt === undefined || now < token.expiresAt ? token.accessToken : null;
}

/**
 * Resolve an access token, refreshing it under the store's distributed lock.
 * Revisioned compare-and-set prevents a refresh from overwriting a concurrent
 * reconnect or revocation that did not participate in the refresh lock.
 */
export async function getRefreshableAccessToken(
  store: TokenStore,
  serviceId: string,
  userId: string,
  refresh: (refreshToken: string) => Promise<OAuthToken>,
): Promise<string | null> {
  const initial = await store.getTokenSnapshot(serviceId, userId);
  if (!initial) return null;

  const initialToken = initial.tokens;
  if (isSupersededOAuthGrant(serviceId, initialToken)) {
    await store.compareAndClearTokens(serviceId, userId, initial.revision);
    return null;
  }
  const now = Date.now();
  if (
    initialToken.expiresAt === undefined ||
    now < initialToken.expiresAt - TOKEN_REFRESH_BUFFER_MS
  ) {
    return initialToken.accessToken;
  }
  if (!initialToken.refreshToken) return unexpiredAccessToken(initialToken, now);

  return await store.withTokenRefreshLock(serviceId, userId, async () => {
    // Another worker may have refreshed this slot while this caller waited.
    const current = await store.getTokenSnapshot(serviceId, userId);
    if (!current) return null;

    const token = current.tokens;
    if (isSupersededOAuthGrant(serviceId, token)) {
      await store.compareAndClearTokens(serviceId, userId, current.revision);
      return null;
    }
    const lockedNow = Date.now();
    if (
      token.expiresAt === undefined ||
      lockedNow < token.expiresAt - TOKEN_REFRESH_BUFFER_MS
    ) {
      return token.accessToken;
    }
    if (!token.refreshToken) return unexpiredAccessToken(token, lockedNow);

    let refreshed: OAuthToken;
    try {
      refreshed = await refresh(token.refreshToken);
    } catch {
      // A provider failure must not unconditionally delete a row that may
      // have been replaced by a concurrent reconnect outside the lock.
      const latest = await store.getTokens(serviceId, userId);
      return latest ? unexpiredAccessToken(latest) : null;
    }

    refreshed = {
      ...refreshed,
      ...(refreshed.refreshToken === undefined ? { refreshToken: token.refreshToken } : {}),
      ...(refreshed.scope === undefined && token.scope !== undefined ? { scope: token.scope } : {}),
      ...(token.scopeSource === undefined ? {} : { scopeSource: token.scopeSource }),
    };

    const replaced = await store.compareAndSetTokens(
      serviceId,
      userId,
      current.revision,
      refreshed,
    );
    if (replaced) return refreshed.accessToken;

    const latest = await store.getTokens(serviceId, userId);
    return latest ? unexpiredAccessToken(latest) : null;
  });
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
  if (!allowsProcessLocalStorage() && store instanceof MemoryTokenStore) {
    throw new Error(
      "MemoryTokenStore is allowed only when NODE_ENV is explicitly development or test",
    );
  }
  configuredTokenStore = createTokenStore(store);
}

/** Resolve the development default without doing work during module import. */
export function createDefaultTokenStore(): TokenStore {
  if (!allowsProcessLocalStorage()) {
    throw new Error(
      "OAuth token storage is not configured. The in-memory default is allowed " +
        "only when NODE_ENV is explicitly development or test. " +
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
  compareAndClearTokens(serviceId, userId, expectedRevision) {
    return getDefaultTokenStore().compareAndClearTokens(serviceId, userId, expectedRevision);
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

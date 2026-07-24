import type { ApplicationOAuthTokenStore } from "./oauth-store-registry.ts";

export const ATLASSIAN_OAUTH_TOKEN_SERVICE_ALIASES = Object.freeze({
  confluence: "atlassian",
  jira: "atlassian",
}) satisfies Readonly<Record<string, string>>;

function createTokenServiceIdResolver(
  aliases: Readonly<Record<string, string>>,
): (serviceId: string) => string {
  const resolvedAliases = new Map<string, string>();

  for (const [logicalServiceId, physicalServiceId] of Object.entries(aliases)) {
    if (
      logicalServiceId.length === 0 ||
      logicalServiceId.trim() !== logicalServiceId
    ) {
      throw new TypeError(
        "OAuth token service alias keys must be non-empty, trimmed strings",
      );
    }
    if (
      physicalServiceId.length === 0 ||
      physicalServiceId.trim() !== physicalServiceId
    ) {
      throw new TypeError(
        "OAuth token service alias values must be non-empty, trimmed strings",
      );
    }
    if (logicalServiceId === physicalServiceId) {
      throw new TypeError(
        `OAuth token service alias "${logicalServiceId}" must target a different service ID`,
      );
    }
    resolvedAliases.set(logicalServiceId, physicalServiceId);
  }

  for (const [logicalServiceId, physicalServiceId] of resolvedAliases) {
    if (resolvedAliases.has(physicalServiceId)) {
      throw new TypeError(
        `OAuth token service alias "${logicalServiceId}" must target a physical service ID`,
      );
    }
  }

  return (serviceId) => resolvedAliases.get(serviceId) ?? serviceId;
}

/**
 * Map logical integration IDs onto shared physical token slots.
 *
 * Only token rows, revisions, and refresh locks are aliased. OAuth state stays
 * keyed by its opaque transaction ID and keeps the initiating logical service
 * so callback dispatch can select the correct integration.
 */
export function createOAuthTokenStoreWithServiceAliases(
  store: ApplicationOAuthTokenStore,
  aliases: Readonly<Record<string, string>>,
): ApplicationOAuthTokenStore {
  const resolveTokenServiceId = createTokenServiceIdResolver(aliases);

  return {
    getTokens(serviceId, userId) {
      return store.getTokens(resolveTokenServiceId(serviceId), userId);
    },
    setTokens(serviceId, userId, tokens) {
      return store.setTokens(
        resolveTokenServiceId(serviceId),
        userId,
        tokens,
      );
    },
    clearTokens(serviceId, userId) {
      return store.clearTokens(resolveTokenServiceId(serviceId), userId);
    },
    getTokenSnapshot(serviceId, userId) {
      return store.getTokenSnapshot(
        resolveTokenServiceId(serviceId),
        userId,
      );
    },
    compareAndSetTokens(
      serviceId,
      userId,
      expectedRevision,
      tokens,
    ) {
      return store.compareAndSetTokens(
        resolveTokenServiceId(serviceId),
        userId,
        expectedRevision,
        tokens,
      );
    },
    withTokenRefreshLock<T>(
      serviceId: string,
      userId: string,
      operation: () => Promise<T>,
    ) {
      return store.withTokenRefreshLock(
        resolveTokenServiceId(serviceId),
        userId,
        operation,
      );
    },
    setState(state, meta) {
      return store.setState(state, meta);
    },
    consumeState(state) {
      return store.consumeState(state);
    },
    getStorageStatus() {
      return store.getStorageStatus();
    },
  };
}

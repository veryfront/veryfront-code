import { getBaseLogger } from "#veryfront/utils/logger/logger.ts";
import { sanitizeUrlForSpan } from "#veryfront/utils/logger/redact.ts";
import type { FileCache } from "../cache/file-cache.ts";
import { isCacheCredentialRejection } from "#veryfront/cache/backends/api.ts";
import type { ProjectFile, VeryfrontApiClient } from "../../veryfront-api-client/index.ts";
import type {
  ContentSource,
  InvalidationCallbacks,
  InvalidationProjectContext,
  PreviewStyleArtifactInfo,
  ResolvedContentContext,
} from "./types.ts";
import {
  buildDirCacheKeyPrefix,
  buildFileCacheKeyPrefix,
  buildFileListCacheKey,
  buildStatCacheKeyPrefix,
} from "./cache-keys.ts";
import {
  buildFileListProjectPrefix,
  buildVersionedFileOperationProjectPrefix,
} from "#veryfront/cache/keys/builders/file.ts";
import {
  addPendingInvalidation,
  getPendingInvalidationsCount,
  removePendingInvalidation,
} from "./invalidation-state.ts";
import {
  buildContentSourceLabel,
  buildReloadProjectContext,
  getConnectionLogContext as getConnectionLogContextHelper,
  getPreviewInvalidationPrefixes as getPreviewInvalidationPrefixesHelper,
  getReconnectDelay as getReconnectDelayHelper,
  INVALIDATION_DEBOUNCE_MS,
  parsePokeWebSocketMessage,
  WS_HEARTBEAT_INTERVAL_MS,
  WS_HEARTBEAT_TIMEOUT_MS,
  WS_RECONNECT_MAX_DELAY_MS,
  WS_RECONNECT_MAX_FAILURES,
} from "./websocket-manager-helpers.ts";

const logger = getBaseLogger("SERVER", { injectTraceContext: false }).component(
  "web-socket-manager",
);
const IntrinsicReflectApply = Reflect.apply;
const IntrinsicWebSocket = WebSocket;
const IntrinsicCrypto = crypto;
const CryptoRandomUUID = IntrinsicCrypto.randomUUID;
const DateNow = Date.now;
const StringPrototypeReplace = String.prototype.replace;
const StringPrototypeSlice = String.prototype.slice;

type WebSocketFactory = (
  url: string,
  protocols?: string | string[],
) => WebSocket;

interface PreviewInvalidationToken {
  entries: Array<{ prefix: string; version: number }>;
}

interface PendingSelectiveInvalidation {
  contentContext: ResolvedContentContext | null;
  changedPaths: Set<string>;
  token: PreviewInvalidationToken;
  /** Every poke in this batch changed only reserved data files and kept the snapshot. */
  reservedDataOnly: boolean;
}

function createIntrinsicWebSocket(
  url: string,
  protocols?: string | string[],
): WebSocket {
  return new IntrinsicWebSocket(url, protocols);
}

function currentTime(): number {
  return IntrinsicReflectApply(DateNow, Date, []) as number;
}

function replaceString(
  value: string,
  searchValue: string | RegExp,
  replaceValue: string,
): string {
  return IntrinsicReflectApply(StringPrototypeReplace, value, [
    searchValue,
    replaceValue,
  ]) as string;
}

function randomUUID(): string {
  return IntrinsicReflectApply(CryptoRandomUUID, IntrinsicCrypto, []) as string;
}

function sliceString(value: string, start: number, end: number): string {
  return IntrinsicReflectApply(StringPrototypeSlice, value, [start, end]) as string;
}

function sanitizeWebSocketLogUrl(url: string | undefined): string | undefined {
  return typeof url === "string" ? sanitizeUrlForSpan(url) : undefined;
}

interface SourceListingStart {
  dataGeneration: number;
  readSequence: number;
}

interface WebSocketDeps {
  apiBaseUrl: string;
  apiToken: string;
  projectSlug: string;
  cache: FileCache;
  client: VeryfrontApiClient;
  invalidationCallbacks: InvalidationCallbacks;
  /**
   * The project's default branch name. Used to decide whether an unscoped
   * production poke applies to the current branch preview. Defaults to "main"
   * when not provided; set this to the project's actual default branch to
   * avoid skipping valid production pokes on non-"main" default branches.
   */
  defaultBranchName?: string;

  getContentContext: () => ResolvedContentContext | null;
  getEffectiveContentContext?: () => ResolvedContentContext | null;
  getContentSource: () => ContentSource;
  getProjectDir: () => string | undefined;
  clearMemoryCaches: () => void;
  getFileListCacheKey?: () => string | undefined;
  getSourceSnapshotVersion?: () => number;
  replaceSourceSnapshot: (
    cacheKey: string,
    files: ProjectFile[],
    expectedSnapshotVersion?: number,
    listingStart?: SourceListingStart,
  ) => Promise<number | undefined>;
  /**
   * Mark the start of a source listing, so reserved data patches that land
   * while it is in flight survive it and older ones yield to it.
   */
  beginSourceListing?: () => SourceListingStart;
  /**
   * Whether a poke that changed only `changedPaths` can be applied by patching
   * reserved data files (knowledge Markdown, eval reports) into the snapshot
   * instead of invalidating it.
   */
  canPatchReservedDataPaths?: (changedPaths: readonly string[]) => boolean;
  /**
   * Patch the changed reserved data files into the snapshot. Resolves
   * `"definition"` when a changed path may define an agent or skill, `"data"`
   * when none can, and undefined when the snapshot must be invalidated.
   */
  refreshReservedDataPaths?: (
    changedPaths: readonly string[],
  ) => Promise<"data" | "definition" | undefined>;
  pregenerateStyles?: (
    files: ProjectFile[],
  ) => Promise<PreviewStyleArtifactInfo | undefined>;
  createWebSocket?: WebSocketFactory;
}

const OPERATION_CACHE_TYPES = ["file", "stat", "dir"] as const;
/** Legacy and versioned source namespaces of file/stat/directory keys. */
const OPERATION_SOURCE_TYPES = [
  "branch",
  "release",
  "env",
  "branch-v2",
  "release-v2",
  "env-v2",
] as const;

/** Exact file, stat and directory source prefixes of one content context. */
function buildOperationSourcePrefixes(contentContext: ResolvedContentContext): {
  file: string;
  stat: string;
  dir: string;
} {
  return {
    file: `${buildFileCacheKeyPrefix(contentContext)}:`,
    stat: `${buildStatCacheKeyPrefix(contentContext)}:`,
    dir: `${buildDirCacheKeyPrefix(contentContext)}:`,
  };
}

export class WebSocketManager {
  private ws: WebSocket | null = null;
  private wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private wsHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private wsLastPong = currentTime();
  private invalidationTimer: ReturnType<typeof setTimeout> | null = null;
  private selectiveInvalidationTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingSelectiveInvalidations = new Map<string, PendingSelectiveInvalidation>();
  private pendingFullInvalidations = new Map<
    string,
    { contentContext: ResolvedContentContext | null; token: PreviewInvalidationToken }
  >();

  private wsConnectionId: string | null = null;
  private wsConsecutiveFailures = 0;
  private wsErrorLogged = false;
  private disposed = false;
  /** Set once the adapter was evicted because the API no longer accepts its credential. */
  private credentialRetired = false;
  private nextPreviewInvalidationVersion = 0;
  private previewInvalidationVersions = new Map<string, number>();
  private activePreviewInvalidationPrefixes = new Set<string>();
  /** Pokes accepted for invalidation, so a running invalidation can see newer ones. */
  private acceptedPokes = 0;
  private pokeMetrics = {
    received: 0,
    invalidationsTriggered: 0,
    lastPokeTime: 0,
  };

  private apiToken: string;
  #createWebSocket: WebSocketFactory;

  constructor(private readonly deps: WebSocketDeps) {
    this.apiToken = deps.apiToken;
    this.#createWebSocket = deps.createWebSocket ?? createIntrinsicWebSocket;
  }

  setApiToken(token: string): void {
    this.apiToken = token;
  }

  private getConnectionLogContext(context: Record<string, unknown> = {}): Record<string, unknown> {
    return getConnectionLogContextHelper(this.deps.projectSlug, context);
  }

  private getPreviewInvalidationPrefixes(
    contentContext: ResolvedContentContext | null,
  ): string[] {
    return getPreviewInvalidationPrefixesHelper(contentContext);
  }

  private getActiveContentContext(): ResolvedContentContext | null {
    return this.deps.getEffectiveContentContext?.() ?? this.deps.getContentContext();
  }

  private clearPersistentBranchCache(branch: string): void {
    const context: ResolvedContentContext = {
      sourceType: "branch",
      projectSlug: this.deps.projectSlug,
      branch,
    };
    const pendingPrefixes = [
      buildFileCacheKeyPrefix(context),
      buildStatCacheKeyPrefix(context),
      buildDirCacheKeyPrefix(context),
    ];
    const deletionPrefixes = [...pendingPrefixes, buildFileListCacheKey(context)];
    for (const prefix of pendingPrefixes) addPendingInvalidation(prefix);
    void Promise.all(
      deletionPrefixes.map((prefix) => this.deps.cache.deleteByPrefixAsync(prefix)),
    ).then(
      () => {
        for (const prefix of pendingPrefixes) removePendingInvalidation(prefix);
      },
      (error) => {
        if (this.retireOnCredentialRejection(error)) return;
        logger.error("Branch poke cache invalidation failed", {
          projectSlug: this.deps.projectSlug,
          error: error instanceof Error ? error.message : String(error),
        });
      },
    );
  }

  private beginPreviewInvalidation(
    contentContext: ResolvedContentContext | null,
  ): PreviewInvalidationToken {
    const prefixes = this.getPreviewInvalidationPrefixes(contentContext);
    const entries: PreviewInvalidationToken["entries"] = [];

    for (const prefix of prefixes) {
      const version = ++this.nextPreviewInvalidationVersion;
      this.previewInvalidationVersions.set(prefix, version);
      entries.push({ prefix, version });
      if (this.activePreviewInvalidationPrefixes.has(prefix)) continue;
      addPendingInvalidation(prefix);
      this.activePreviewInvalidationPrefixes.add(prefix);
    }
    return { entries };
  }

  private completePreviewInvalidation(token: PreviewInvalidationToken): void {
    for (const { prefix, version } of token.entries) {
      if (this.previewInvalidationVersions.get(prefix) !== version) continue;
      this.previewInvalidationVersions.delete(prefix);
      if (!this.activePreviewInvalidationPrefixes.delete(prefix)) continue;
      removePendingInvalidation(prefix);
    }
  }

  getPokeMetrics(): {
    received: number;
    invalidationsTriggered: number;
    lastPokeTime: number;
    connectionId: string | null;
  } {
    return { ...this.pokeMetrics, connectionId: this.wsConnectionId };
  }

  connect(projectId: string): void {
    if (this.disposed) return;

    this.cleanupTimers();

    if (this.wsConsecutiveFailures >= WS_RECONNECT_MAX_FAILURES) {
      // Intentional infinite-retry: once the failure cap is hit the counter
      // resets so reconnection continues at the maximum back-off delay rather
      // than stopping permanently. This is the desired long-running-server behavior.
      logger.warn(
        "WebSocket reconnect failure cap reached — resetting counter for continued retry at max delay",
        {
          consecutiveFailures: this.wsConsecutiveFailures,
          maxFailures: WS_RECONNECT_MAX_FAILURES,
          cappedDelayMs: WS_RECONNECT_MAX_DELAY_MS,
          projectId,
        },
      );
      this.wsConsecutiveFailures = 0;
    }

    const wsUrl = replaceString(
      replaceString(
        replaceString(this.deps.apiBaseUrl, /^http:/, "ws:"),
        /^https:/,
        "wss:",
      ),
      /\/api$/,
      "",
    );

    // The WebSocket protocol (ws vs wss) is derived from the configured
    // apiBaseUrl (http→ws, https→wss). No forced upgrade is needed because
    // the auth token is sent via a subprotocol header, not in the URL.

    const url = `${wsUrl}/ws/${projectId}/events`;

    logger.debug(
      "Connecting to WebSocket",
      this.getConnectionLogContext({
        url: sanitizeWebSocketLogUrl(url),
        consecutiveFailures: this.wsConsecutiveFailures,
      }),
    );

    try {
      // Send the API token via a WebSocket subprotocol header instead of
      // a query-string parameter. Query strings can leak into server
      // access logs, proxy logs, and the browser's Referer header.
      this.ws = IntrinsicReflectApply(this.#createWebSocket, undefined, [
        url,
        [`bearer-${this.apiToken}`],
      ]) as WebSocket;
      this.wsConnectionId = sliceString(randomUUID(), 0, 8);
      this.wsErrorLogged = false;

      this.ws.onopen = () => {
        const recoveredFailures = this.wsConsecutiveFailures;
        this.wsConsecutiveFailures = 0;
        logger.debug(
          "WebSocket connected to events channel",
          this.getConnectionLogContext({
            projectId,
            connectionId: this.wsConnectionId,
            ...buildContentSourceLabel(this.deps.getContentSource, this.deps.getContentContext),
          }),
        );
        if (recoveredFailures > 0) {
          logger.info(
            "WebSocket reconnect recovered",
            this.getConnectionLogContext({
              projectId,
              project_id: projectId,
              connectionId: this.wsConnectionId,
              consecutiveFailures: recoveredFailures,
              ...buildContentSourceLabel(this.deps.getContentSource, this.deps.getContentContext),
            }),
          );
        }
        this.wsLastPong = currentTime();
        this.startHeartbeat(projectId);
      };

      this.ws.onmessage = (event) => {
        this.wsLastPong = currentTime();
        logger.debug("WebSocket message received", {
          payloadType: typeof event.data,
          payloadLength: typeof event.data === "string" ? event.data.length : undefined,
        });
        this.handlePokeMessage(event);
      };

      this.ws.onclose = (event) => {
        const connectionId = this.wsConnectionId;
        const url = this.ws?.url;
        this.wsConnectionId = null;
        this.cleanupTimers();

        if (this.disposed) return;

        this.wsConsecutiveFailures++;
        const delay = this.getReconnectDelay();
        logger.warn(
          "WebSocket reconnect scheduled after close",
          this.getConnectionLogContext({
            projectId,
            project_id: projectId,
            connectionId,
            url: sanitizeWebSocketLogUrl(url),
            delayMs: delay,
            totalPokesReceived: this.pokeMetrics.received,
            consecutiveFailures: this.wsConsecutiveFailures,
            closeCode: event.code,
            closeReason: event.reason,
            wasClean: event.wasClean,
          }),
        );
        this.wsReconnectTimer = setTimeout(() => this.connect(projectId), delay);
      };

      this.ws.onerror = (event) => {
        // Log once per connection attempt to avoid flooding logs.
        if (!this.wsErrorLogged) {
          this.wsErrorLogged = true;
          logger.warn(
            "WebSocket error",
            this.getConnectionLogContext({
              type: event.type,
              url: sanitizeWebSocketLogUrl((event.target as WebSocket)?.url),
              readyState: (event.target as WebSocket)?.readyState,
              consecutiveFailures: this.wsConsecutiveFailures,
            }),
          );
        }
      };
    } catch (error) {
      this.wsConsecutiveFailures++;
      const delay = this.getReconnectDelay();
      logger.warn(
        "Failed to connect WebSocket",
        this.getConnectionLogContext({
          error,
          consecutiveFailures: this.wsConsecutiveFailures,
        }),
      );
      this.wsReconnectTimer = setTimeout(() => this.connect(projectId), delay);
    }
  }

  private getReconnectDelay(): number {
    // Exponential backoff: 5s, 10s, 20s, 40s, 80s, capped at 120s
    return getReconnectDelayHelper(this.wsConsecutiveFailures);
  }

  dispose(): void {
    this.disposed = true;
    this.cleanupTimers();

    if (this.invalidationTimer) {
      clearTimeout(this.invalidationTimer);
      this.invalidationTimer = null;
    }

    if (this.selectiveInvalidationTimer) {
      clearTimeout(this.selectiveInvalidationTimer);
      this.selectiveInvalidationTimer = null;
    }

    for (const pending of this.pendingSelectiveInvalidations.values()) {
      this.completePreviewInvalidation(pending.token);
    }
    for (const pending of this.pendingFullInvalidations.values()) {
      this.completePreviewInvalidation(pending.token);
    }
    this.pendingSelectiveInvalidations.clear();
    this.pendingFullInvalidations.clear();

    if (!this.ws) return;

    // Detach handlers before closing to prevent onclose from scheduling a reconnect
    this.ws.onclose = null;
    this.ws.onerror = null;
    this.ws.onmessage = null;

    try {
      this.ws.close();
    } catch (error) {
      logger.warn("Error closing WebSocket", { error });
    } finally {
      this.ws = null;
    }
  }

  /**
   * Evict the adapter once its credential is expired or rejected. The socket
   * keeps the credential of the request that opened it, so every later poke
   * would run its cache invalidations under that credential and be refused.
   * Requests carrying a current credential get a fresh adapter. A standalone
   * adapter cannot be replaced that way, so it keeps handling pokes. Reports
   * whether the adapter is retired.
   */
  private retireForCredential(reason: "expired" | "rejected"): boolean {
    if (this.credentialRetired) return true;
    if (!this.deps.invalidationCallbacks.evictCurrentAdapter) return false;
    this.credentialRetired = true;
    if (this.disposed) return true;
    logger.info(
      reason === "expired"
        ? "Retiring adapter whose API credential expired"
        : "Retiring adapter whose API credential was rejected",
      { projectSlug: this.deps.projectSlug },
    );
    this.deps.invalidationCallbacks.evictCurrentAdapter();
    return true;
  }

  /** Whether this adapter's credential can no longer invalidate caches. */
  private retireIfCredentialUnusable(): boolean {
    if (this.credentialRetired) return true;
    return this.deps.invalidationCallbacks.isCredentialExpired?.() === true &&
      this.retireForCredential("expired");
  }

  /** Retire the adapter when the API refused its credential. */
  private retireOnCredentialRejection(error: unknown): boolean {
    return isCacheCredentialRejection(error) && this.retireForCredential("rejected");
  }

  /**
   * Run debounced invalidations in order. The credential is checked before
   * each one, because it can expire or be refused between the poke and the
   * batch. Batches skipped that way release their preview markers, as
   * `dispose()` does for batches that never ran.
   */
  private async runQueuedInvalidations<T extends { token: PreviewInvalidationToken }>(
    queued: T[],
    perform: (invalidation: T) => Promise<void>,
    failureMessage: "Queued full invalidation failed" | "Queued selective invalidation failed",
  ): Promise<void> {
    for (const [index, invalidation] of queued.entries()) {
      if (this.retireIfCredentialUnusable()) {
        for (const skipped of queued.slice(index)) this.completePreviewInvalidation(skipped.token);
        return;
      }
      try {
        await perform(invalidation);
      } catch (error) {
        if (this.retireOnCredentialRejection(error)) continue;
        logger.error(failureMessage, {
          projectSlug: this.deps.projectSlug,
          error,
        });
      }
    }
  }

  private handlePokeMessage(event: MessageEvent): void {
    try {
      const message = parsePokeWebSocketMessage(event.data as string);
      if (!message) return;
      if (this.retireIfCredentialUnusable()) {
        // The domain cache is process-wide and needs no API credential.
        this.deps.invalidationCallbacks.clearDomainCache?.();
        return;
      }
      const payload = message.payload;

      // Validate payload fields rather than blindly casting Record<string,unknown>.
      // Unexpected shapes are coerced to safe defaults and logged so malformed
      // server messages produce a visible warning instead of silent bad values.
      const rawChangedPaths = payload.changedPaths;
      const changedPaths: string[] | undefined = Array.isArray(rawChangedPaths) &&
          rawChangedPaths.every((p) => typeof p === "string")
        ? (rawChangedPaths as string[])
        : rawChangedPaths !== undefined
        ? (logger.warn("[WebSocketManager] POKE payload.changedPaths has unexpected shape", {
          type: typeof rawChangedPaths,
        }),
          undefined)
        : undefined;

      const contentContext = this.getActiveContentContext();

      const rawBranchId = payload.branchId;
      const pokeBranchId: string | null | undefined = typeof rawBranchId === "string" ||
          rawBranchId === null ||
          rawBranchId === undefined
        ? (rawBranchId as string | null | undefined)
        : null;

      const rawBranchName = payload.branchName;
      const pokeBranchName: string | null | undefined = typeof rawBranchName === "string" ||
          rawBranchName === null ||
          rawBranchName === undefined
        ? (rawBranchName as string | null | undefined)
        : null;

      const normalizedBranchId = typeof pokeBranchId === "string" && pokeBranchId.length > 0
        ? pokeBranchId
        : null;
      const normalizedBranchName = typeof pokeBranchName === "string" && pokeBranchName.length > 0
        ? pokeBranchName
        : null;

      const timeSinceLastPoke = this.pokeMetrics.lastPokeTime > 0
        ? currentTime() - this.pokeMetrics.lastPokeTime
        : null;

      this.pokeMetrics.received++;
      this.pokeMetrics.lastPokeTime = currentTime();

      const isProductionMode = contentContext?.sourceType !== "branch";
      const currentBranch = contentContext?.branch ?? null;
      const hasBranchScope = !!normalizedBranchName || !!normalizedBranchId;
      const isProductionPoke = !hasBranchScope;

      logger.debug("POKE RECEIVED - checking environment scope", {
        type: message.type,
        hasBranchId: normalizedBranchId !== null,
        hasBranchName: normalizedBranchName !== null,
        isProductionPoke,
        isProductionMode,
        connectionId: this.wsConnectionId,
        totalPokesReceived: this.pokeMetrics.received,
        timeSinceLastPokeMs: timeSinceLastPoke,
      });

      // In production mode, we accept branch-scoped pokes too.
      // Production renders always fetch published content, so clearing caches
      // on preview edits is safe and avoids stale content after publish.
      if (isProductionMode && !isProductionPoke) {
        logger.debug(
          "[WebSocketManager] POKE ACCEPTED - branch-scoped poke in production mode",
          {
            hasBranchId: normalizedBranchId !== null,
            hasBranchName: normalizedBranchName !== null,
            sourceType: contentContext?.sourceType,
          },
        );
      }

      if (!isProductionMode) {
        if (normalizedBranchName && normalizedBranchName !== currentBranch) {
          this.clearPersistentBranchCache(normalizedBranchName);
          logger.debug(
            "[WebSocketManager] POKE SKIPPED - different branch name in preview mode",
            { hasCurrentBranch: currentBranch !== null },
          );
          return;
        }

        if (!normalizedBranchName && normalizedBranchId) {
          if (currentBranch === null) {
            logger.debug(
              "[WebSocketManager] POKE SKIPPED - branchId-only poke for main preview",
              { hasBranchId: true },
            );
            return;
          }

          logger.debug(
            "[WebSocketManager] POKE ACCEPTED - branchId-only fallback in preview mode",
            { hasBranchId: true, hasCurrentBranch: true },
          );
        }

        if (
          !normalizedBranchName && !normalizedBranchId && currentBranch !== null &&
          currentBranch !== (this.deps.defaultBranchName ?? "main")
        ) {
          // Unscoped pokes (no branchId/branchName) target the project's default branch.
          // Skip only if we're previewing a different named branch.
          // `defaultBranchName` defaults to "main"; set it in deps for projects
          // using a different default branch (e.g., "master", "develop").
          logger.debug(
            "[WebSocketManager] POKE SKIPPED - unscoped poke for named branch preview",
            { hasCurrentBranch: true },
          );
          return;
        }
      }

      const rawReleaseId = payload.releaseId;
      const pokeReleaseId: string | null | undefined = typeof rawReleaseId === "string" ||
          rawReleaseId === null ||
          rawReleaseId === undefined
        ? (rawReleaseId as string | null | undefined)
        : null;
      const normalizedPokeReleaseId = typeof pokeReleaseId === "string" && pokeReleaseId.length > 0
        ? pokeReleaseId
        : null;

      const isDeploymentPoke = payload.entityType === "deployment";
      const isPublishPoke = isDeploymentPoke || (isProductionMode && !changedPaths?.length);

      const rawEnvironmentName = payload.environmentName;
      const pokeEnvironmentName: string | null | undefined =
        typeof rawEnvironmentName === "string" ||
          rawEnvironmentName === null ||
          rawEnvironmentName === undefined
          ? (rawEnvironmentName as string | null | undefined)
          : null;
      const normalizedPokeEnvironment =
        typeof pokeEnvironmentName === "string" && pokeEnvironmentName.length > 0
          ? pokeEnvironmentName
          : contentContext?.environmentName ?? (isProductionMode ? "production" : undefined);

      logger.info("POKE ACCEPTED - triggering cache invalidation", {
        changedPathsCount: changedPaths?.length || 0,
        projectSlug: this.deps.projectSlug,
        isDeploymentPoke,
        isPublishPoke,
      });

      const previewInvalidationToken = this.beginPreviewInvalidation(contentContext);
      this.deps.invalidationCallbacks.clearDomainCache?.();
      this.acceptedPokes++;
      // A write to reserved data files is patched into the snapshot once the
      // files are fetched. Clearing it here would supersede every in-flight
      // source refresh, and agents write these files throughout a run.
      const reservedDataOnly = !isPublishPoke &&
        contentContext?.sourceType === "branch" &&
        !!changedPaths?.length &&
        this.deps.canPatchReservedDataPaths?.(changedPaths) === true;
      if (reservedDataOnly) {
        logger.debug("Keeping the source snapshot for a reserved data POKE");
      } else {
        this.deps.clearMemoryCaches();
        logger.debug("All in-memory caches cleared immediately on POKE");
      }

      if (isPublishPoke && this.deps.projectSlug) {
        this.clearPersistentCacheForPublish(normalizedPokeReleaseId, normalizedPokeEnvironment);
      }

      if (changedPaths?.length) {
        this.scheduleSelectiveInvalidation(
          changedPaths,
          contentContext,
          previewInvalidationToken,
          reservedDataOnly,
        );
        return;
      }

      logger.debug("No changedPaths provided - using full invalidation");
      this.scheduleInvalidation(contentContext, previewInvalidationToken);
    } catch (error) {
      logger.debug("WebSocket message parse error", { error });
    }
  }

  private clearPersistentCacheForPublish(
    releaseId: string | null,
    environmentName: string | undefined,
  ): void {
    const deletionPrefixes = new Set<string>();
    const pendingPrefixes = new Set<string>();

    const addPrefixes = (prefixes: string[]): void => {
      for (const prefix of prefixes) {
        deletionPrefixes.add(prefix);
        pendingPrefixes.add(prefix);
      }
    };

    const addContextPrefixes = (ctx: ResolvedContentContext): void => {
      addPrefixes([
        buildFileCacheKeyPrefix(ctx),
        buildStatCacheKeyPrefix(ctx),
        buildDirCacheKeyPrefix(ctx),
        buildFileListCacheKey(ctx),
      ]);
    };

    const addBroadPrefixes = (sourceType: "release" | "environment"): void => {
      const sourceKey = sourceType === "release" ? "release" : "env";
      const base = `${sourceKey}:${this.deps.projectSlug}:`;
      addPrefixes([
        `file:${base}`,
        `stat:${base}`,
        `dir:${base}`,
        buildFileListProjectPrefix(sourceKey, this.deps.projectSlug),
      ]);
      addPrefixes(
        OPERATION_CACHE_TYPES.map((cacheType) =>
          buildVersionedFileOperationProjectPrefix(cacheType, sourceKey, this.deps.projectSlug)
        ),
      );
    };

    if (releaseId) {
      addContextPrefixes({
        sourceType: "release",
        projectSlug: this.deps.projectSlug,
        releaseId,
      });

      if (environmentName) {
        addContextPrefixes({
          sourceType: "environment",
          projectSlug: this.deps.projectSlug,
          environmentName,
          releaseId,
        });
      }
    } else {
      addBroadPrefixes("release");
      addBroadPrefixes("environment");
    }

    for (const prefix of pendingPrefixes) addPendingInvalidation(prefix);

    logger.info("PUBLISH POKE - clearing persistent cache", {
      projectSlug: this.deps.projectSlug,
      deletionPrefixCount: deletionPrefixes.size,
      pendingPrefixCount: pendingPrefixes.size,
      pendingInvalidations: getPendingInvalidationsCount(),
    });

    void (async () => {
      let succeeded = false;
      try {
        const results = await Promise.all(
          Array.from(deletionPrefixes).map((prefix) => this.deps.cache.deleteByPrefixAsync(prefix)),
        );
        const totalDeleted = results.reduce((sum, count) => sum + count, 0);
        succeeded = true;

        logger.info("PUBLISH POKE - persistent cache cleared", {
          projectSlug: this.deps.projectSlug,
          totalDeleted,
        });
      } catch (error) {
        this.retireOnCredentialRejection(error);
        logger.error("PUBLISH POKE - failed to clear persistent cache (stale data may be served)", {
          projectSlug: this.deps.projectSlug,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
      } finally {
        if (succeeded) {
          for (const prefix of pendingPrefixes) removePendingInvalidation(prefix);
        } else {
          // Keep pending invalidations active so reads bypass stale cache
          logger.error(
            "PUBLISH POKE - keeping pending invalidations active due to deletion failure",
            {
              projectSlug: this.deps.projectSlug,
              pendingPrefixCount: pendingPrefixes.size,
            },
          );
        }

        logger.info("PUBLISH POKE - cache invalidation complete", {
          projectSlug: this.deps.projectSlug,
          succeeded,
          pendingInvalidations: getPendingInvalidationsCount(),
        });
      }
    })();
  }

  private invalidationContextKey(contentContext: ResolvedContentContext | null): string {
    return contentContext ? buildFileListCacheKey(contentContext) : "none";
  }

  private scheduleInvalidation(
    contentContext: ResolvedContentContext | null,
    token: PreviewInvalidationToken,
  ): void {
    if (this.invalidationTimer) clearTimeout(this.invalidationTimer);
    this.pendingFullInvalidations.set(this.invalidationContextKey(contentContext), {
      contentContext,
      token,
    });

    logger.debug("Scheduling invalidation", {
      debounceMs: INVALIDATION_DEBOUNCE_MS,
    });

    this.invalidationTimer = setTimeout(() => {
      this.invalidationTimer = null;
      const pending = [...this.pendingFullInvalidations.values()];
      this.pendingFullInvalidations.clear();
      void this.runQueuedInvalidations(
        pending,
        (invalidation) => this.performInvalidation(invalidation.contentContext, invalidation.token),
        "Queued full invalidation failed",
      );
    }, INVALIDATION_DEBOUNCE_MS);
  }

  private scheduleSelectiveInvalidation(
    changedPaths: string[],
    contentContext: ResolvedContentContext | null,
    token: PreviewInvalidationToken,
    reservedDataOnly = false,
  ): void {
    const contextKey = this.invalidationContextKey(contentContext);
    const pending = this.pendingSelectiveInvalidations.get(contextKey) ?? {
      contentContext,
      changedPaths: new Set<string>(),
      token,
      reservedDataOnly,
    };
    for (const path of changedPaths) pending.changedPaths.add(path);
    pending.token = token;
    pending.reservedDataOnly &&= reservedDataOnly;
    this.pendingSelectiveInvalidations.set(contextKey, pending);

    if (this.selectiveInvalidationTimer) clearTimeout(this.selectiveInvalidationTimer);

    logger.debug("Scheduling selective invalidation", {
      newPaths: changedPaths.length,
      totalPending: [...this.pendingSelectiveInvalidations.values()].reduce(
        (count, invalidation) => count + invalidation.changedPaths.size,
        0,
      ),
      debounceMs: INVALIDATION_DEBOUNCE_MS,
    });

    this.selectiveInvalidationTimer = setTimeout(() => {
      this.selectiveInvalidationTimer = null;
      const scheduled = [...this.pendingSelectiveInvalidations.values()];
      this.pendingSelectiveInvalidations.clear();
      void this.runQueuedInvalidations(
        scheduled,
        (invalidation) =>
          this.performSelectiveInvalidation(
            [...invalidation.changedPaths],
            invalidation.contentContext,
            invalidation.token,
            invalidation.reservedDataOnly,
          ),
        "Queued selective invalidation failed",
      );
    }, INVALIDATION_DEBOUNCE_MS);
  }

  /**
   * Drop this project's compiled and prepared CSS caches, including the style
   * scans keyed by project scope. Returns nothing when no callback is wired.
   */
  private clearProjectCSSCaches(): Promise<void> | undefined {
    if (!this.deps.invalidationCallbacks.clearProjectCSSCache || !this.deps.projectSlug) {
      return undefined;
    }
    return Promise.resolve(
      this.deps.invalidationCallbacks.clearProjectCSSCache(this.deps.projectSlug),
    );
  }

  /**
   * Whether a request used this adapter recently. Adapters outside a shared
   * proxy manager have no usage signal and always count as in use.
   */
  private isAdapterInUse(): boolean {
    return this.deps.invalidationCallbacks.isAdapterInUse?.() ?? true;
  }

  /**
   * Finish a branch poke for an adapter no request is using without listing
   * the project again. Every cached adapter receives every poke, so re-listing
   * for adapters left behind by finished agent runs multiplies each write by
   * the number of cached adapters. The poke already dropped this adapter's
   * listing, so the next read lists the project on demand, and the eviction
   * that follows a completed invalidation disposes the adapter.
   *
   * Returns whether a newer poke superseded this one while it ran. Evicting
   * then would dispose the adapter and cancel the newer poke's invalidation.
   */
  private async skipUnusedAdapterRelist(acceptedPokes: number): Promise<boolean> {
    try {
      await this.clearProjectCSSCaches();
    } catch (error) {
      logger.warn("Failed to clear project CSS caches for an unused adapter", {
        projectSlug: this.deps.projectSlug,
        error,
      });
    }
    logger.debug("Skipped re-listing files for an adapter no request is using", {
      projectSlug: this.deps.projectSlug,
    });
    return this.acceptedPokes !== acceptedPokes;
  }

  /**
   * Install the branch listing a poke invalidated, or skip the listing for an
   * adapter no request is using. Reports a superseded refresh so the caller
   * neither publishes a reload nor evicts the adapter.
   */
  private async refreshBranchSnapshot(
    contentContext: ResolvedContentContext,
    sourceSnapshotVersion: number | undefined,
    acceptedPokes: number,
    invalidationKind: "selective" | "full",
  ): Promise<{
    preparedStyleArtifact: PreviewStyleArtifactInfo | undefined;
    reloadSuperseded: boolean;
  }> {
    if (!this.isAdapterInUse()) {
      return {
        preparedStyleArtifact: undefined,
        reloadSuperseded: await this.skipUnusedAdapterRelist(acceptedPokes),
      };
    }

    let preparedStyleArtifact: PreviewStyleArtifactInfo | undefined;
    let reloadSuperseded = false;
    // Set before the clear is awaited, not after: the catch below is the
    // fallback for a poke that never reached the clear, so a clear that ran and
    // failed must not be retried there either.
    let clearedProjectCSSCaches = false;
    try {
      const listingStart = this.deps.beginSourceListing?.();
      const files = await this.deps.client.listAllFiles({}, {
        type: "branch",
        name: contentContext.branch ?? "main",
      });
      const cacheKey = buildFileListCacheKey(contentContext);
      const appliedSnapshotVersion = await this.deps.replaceSourceSnapshot(
        cacheKey,
        files,
        sourceSnapshotVersion,
        listingStart,
      );
      clearedProjectCSSCaches = true;
      await this.clearProjectCSSCaches();
      if (appliedSnapshotVersion === undefined) {
        reloadSuperseded = true;
      } else {
        preparedStyleArtifact = await this.deps.pregenerateStyles?.(files);
        const currentSnapshotVersion = this.deps.getSourceSnapshotVersion?.();
        if (
          currentSnapshotVersion !== undefined &&
          currentSnapshotVersion !== appliedSnapshotVersion
        ) {
          preparedStyleArtifact = undefined;
          reloadSuperseded = true;
        }

        logger.debug(
          invalidationKind === "selective"
            ? "Fresh files cached (memory + Redis)"
            : "FRESH FILES FETCHED",
          {
            cacheKey,
            fileCount: files.length,
            styleAssetPath: preparedStyleArtifact?.assetPath,
          },
        );
      }
    } catch (error) {
      // Only the file fetch and the snapshot replacement run before the
      // clear above; a throw from either means nothing cleared the CSS
      // caches for this poke. Later steps (style pre-generation, the
      // snapshot version re-read) throw after the clear has already run, so
      // repeating it there would just drop the caches twice.
      if (!clearedProjectCSSCaches) await this.clearProjectCSSCaches();
      logger.warn(
        invalidationKind === "selective"
          ? "Failed to fetch files during selective invalidation"
          : "Failed to fetch files during invalidation",
        { error },
      );
    }
    return { preparedStyleArtifact, reloadSuperseded };
  }

  /**
   * Patch a reserved-data-only batch into the snapshot. Falls back to clearing
   * the snapshot, which the poke skipped, when the adapter is idle (it is
   * evicted instead) or the files cannot be patched.
   */
  private async patchReservedData(
    changedPaths: string[],
  ): Promise<"data" | "definition" | undefined> {
    const kind = this.isAdapterInUse()
      ? await this.deps.refreshReservedDataPaths?.(changedPaths)
      : undefined;
    if (kind === undefined) {
      this.deps.clearMemoryCaches();
      logger.debug("All in-memory caches cleared for an unpatched reserved data POKE");
    }
    return kind;
  }

  private async performSelectiveInvalidation(
    changedPaths: string[],
    contentContext: ResolvedContentContext | null,
    previewInvalidationToken: PreviewInvalidationToken,
    reservedDataOnly = false,
  ): Promise<void> {
    const startTime = currentTime();
    const acceptedPokes = this.acceptedPokes;
    let preparedStyleArtifact: PreviewStyleArtifactInfo | undefined;
    let reloadSuperseded = false;
    let cacheInvalidated = false;
    let reservedDataKind: "data" | "definition" | undefined;

    try {
      if (reservedDataOnly) reservedDataKind = await this.patchReservedData(changedPaths);
      // Read after any fallback clear above, which advances the version.
      const sourceSnapshotVersion = this.deps.getSourceSnapshotVersion?.();
      // Pure data writes cannot change modules, routes, discovered agents or
      // styles; a possible Markdown definition still drops those caches.
      const refreshesDerivedCaches = reservedDataKind !== "data";

      logger.debug("Performing selective invalidation", {
        count: changedPaths.length,
      });

      // A known source deletes only its own exact prefixes. Without one, every
      // legacy and versioned source namespace is cleared for the changed paths.
      const exactPrefixes = contentContext ? buildOperationSourcePrefixes(contentContext) : null;
      const prefixesFor = (cacheType: typeof OPERATION_CACHE_TYPES[number]): string[] =>
        exactPrefixes
          ? [exactPrefixes[cacheType]]
          : OPERATION_SOURCE_TYPES.map((sourceType) => `${cacheType}:${sourceType}:`);

      const parentDirs = new Set<string>();
      const deletionPromises: Promise<number>[] = [];

      for (const path of changedPaths) {
        const slashIndex = path.lastIndexOf("/");
        parentDirs.add(slashIndex > 0 ? path.substring(0, slashIndex) : "");

        for (const prefix of [...prefixesFor("file"), ...prefixesFor("stat")]) {
          deletionPromises.push(this.deps.cache.deleteByPrefixAndSuffixAsync(prefix, path));
        }
      }

      for (const parentDir of parentDirs) {
        for (const prefix of prefixesFor("dir")) {
          deletionPromises.push(this.deps.cache.deleteByPrefixAndSuffixAsync(prefix, parentDir));
        }
      }

      await Promise.all(deletionPromises);

      logger.debug("Cache entries deleted for changed paths", {
        changedPathsCount: changedPaths.length,
        parentDirsCount: parentDirs.size,
        prefixes: ["file:", "stat:", "dir:"],
      });

      const projectId = this.deps.client.getProjectId();
      const invalidations: Array<void | Promise<void>> = [
        this.deps.invalidationCallbacks.invalidateModulePaths?.(changedPaths),
      ];
      logger.debug("Clearing SSR module cache for HMR", {
        changedPathsCount: changedPaths.length,
        projectId,
        usePerProject: !!this.deps.invalidationCallbacks.clearSSRModuleCacheForProject,
      });

      if (!refreshesDerivedCaches) {
        logger.debug("Keeping module, route and discovery caches for reserved data files");
      } else if (this.deps.invalidationCallbacks.clearSSRModuleCacheForProject && projectId) {
        invalidations.push(
          this.deps.invalidationCallbacks.clearSSRModuleCacheForProject(projectId),
        );
      } else {
        invalidations.push(this.deps.invalidationCallbacks.clearSSRModuleCache?.());
      }
      if (projectId && refreshesDerivedCaches) {
        if (this.deps.invalidationCallbacks.clearRouterDetectionCacheForProject) {
          invalidations.push(
            this.deps.invalidationCallbacks.clearRouterDetectionCacheForProject(projectId),
          );
        }
        if (this.deps.invalidationCallbacks.clearProjectDiscoveryCacheForProject) {
          invalidations.push(
            this.deps.invalidationCallbacks.clearProjectDiscoveryCacheForProject(projectId),
          );
        }
      }

      if (this.deps.invalidationCallbacks.clearRendererCacheForProject && projectId) {
        invalidations.push(
          this.deps.invalidationCallbacks.clearRendererCacheForProject(projectId),
        );
      }

      // A branch poke clears the CSS caches after `replaceSourceSnapshot`
      // installs the new sources instead of here, so a concurrent request
      // cannot refill them from the snapshot this poke is replacing. A
      // patched possible definition replaced nothing, so it clears them here.
      if (contentContext?.sourceType !== "branch" || reservedDataKind === "definition") {
        invalidations.push(this.clearProjectCSSCaches());
      }

      const pendingInvalidations = invalidations.filter(
        (invalidation): invalidation is Promise<void> => invalidation !== undefined,
      );
      if (pendingInvalidations.length > 0) {
        await Promise.all(pendingInvalidations);
      }

      if (contentContext?.sourceType === "branch" && reservedDataKind === undefined) {
        await this.deps.cache.deleteByPrefixAsync("files:branch:");
        ({ preparedStyleArtifact, reloadSuperseded } = await this.refreshBranchSnapshot(
          contentContext,
          sourceSnapshotVersion,
          acceptedPokes,
          "selective",
        ));
      }

      this.pokeMetrics.invalidationsTriggered++;
      cacheInvalidated = true;

      if (reloadSuperseded) {
        logger.debug("Skipping reload for superseded selective invalidation", {
          changedPathsCount: changedPaths.length,
          projectSlug: this.deps.projectSlug,
        });
      } else {
        logger.info(
          "[WebSocketManager] TRIGGERING HMR RELOAD via invalidationCallbacks.triggerReload",
          {
            changedPathsCount: changedPaths.length,
            projectSlug: this.deps.projectSlug,
            projectId: this.deps.client.getProjectId(),
            hasTriggerReloadCallback: !!this.deps.invalidationCallbacks.triggerReload,
          },
        );

        const projectContext = buildReloadProjectContext(
          contentContext,
          this.deps.projectSlug,
          this.deps.client.getProjectId(),
          preparedStyleArtifact,
        );

        void this.triggerReload(changedPaths, projectContext);
      }

      logger.info("Selective invalidation complete", {
        changedPathsCount: changedPaths.length,
        durationMs: currentTime() - startTime,
        totalInvalidations: this.pokeMetrics.invalidationsTriggered,
        reloadTriggered: !reloadSuperseded,
      });
    } finally {
      if (cacheInvalidated) {
        this.sendPokeAck("selective", changedPaths);
        this.completePreviewInvalidation(previewInvalidationToken);
        // A patched adapter is current; evicting it would make the next
        // request list the whole project again.
        if (!reloadSuperseded && reservedDataKind === undefined) {
          this.deps.invalidationCallbacks.evictCurrentAdapter?.();
        }
      }
    }
  }

  private async performInvalidation(
    contentContext: ResolvedContentContext | null,
    previewInvalidationToken: PreviewInvalidationToken,
  ): Promise<void> {
    const startTime = currentTime();
    // Captured before the awaited deletions below, so a poke that arrives
    // while they run counts as newer than this invalidation.
    const acceptedPokes = this.acceptedPokes;
    let preparedStyleArtifact: PreviewStyleArtifactInfo | undefined;
    let reloadSuperseded = false;
    let cacheInvalidated = false;
    // A known source deletes only its own exact prefixes, preserving sibling
    // branches. Publish handling clears release and environment scopes first.
    const exactPrefixes = contentContext ? buildOperationSourcePrefixes(contentContext) : null;
    const deleteOperationSourcePrefix = async (
      cacheType: typeof OPERATION_CACHE_TYPES[number],
      sourceType: "branch" | "release" | "env",
    ): Promise<number> => {
      if (exactPrefixes) {
        const exactSourceType = contentContext?.sourceType === "environment"
          ? "env"
          : contentContext?.sourceType;
        return exactSourceType === sourceType
          ? await this.deps.cache.deleteByPrefixAsync(exactPrefixes[cacheType])
          : 0;
      }
      const [legacy, encoded] = await Promise.all([
        this.deps.cache.deleteByPrefixAsync(`${cacheType}:${sourceType}:`),
        this.deps.cache.deleteByPrefixAsync(`${cacheType}:${sourceType}-v2:`),
      ]);
      return legacy + encoded;
    };

    try {
      logger.debug("CACHE INVALIDATION STARTED - clearing all caches");

      const [
        fileBranchCount,
        fileReleaseCount,
        fileEnvCount,
        statBranchCount,
        statReleaseCount,
        statEnvCount,
        dirBranchCount,
        dirReleaseCount,
        dirEnvCount,
        filesBranchCount,
        filesReleaseCount,
        filesEnvCount,
      ] = await Promise.all([
        deleteOperationSourcePrefix("file", "branch"),
        deleteOperationSourcePrefix("file", "release"),
        deleteOperationSourcePrefix("file", "env"),
        deleteOperationSourcePrefix("stat", "branch"),
        deleteOperationSourcePrefix("stat", "release"),
        deleteOperationSourcePrefix("stat", "env"),
        deleteOperationSourcePrefix("dir", "branch"),
        deleteOperationSourcePrefix("dir", "release"),
        deleteOperationSourcePrefix("dir", "env"),
        this.deps.cache.deleteByPrefixAsync("files:branch:"),
        this.deps.cache.deleteByPrefixAsync("files:release:"),
        this.deps.cache.deleteByPrefixAsync("files:env:"),
      ]);

      // These caches are also cleared immediately on POKE receipt (before debounce).
      // These calls are redundant safety nets for the full invalidation flow.
      this.deps.clearMemoryCaches();
      const sourceSnapshotVersion = this.deps.getSourceSnapshotVersion?.();
      this.deps.invalidationCallbacks.clearDomainCache?.();

      const projectId = this.deps.client.getProjectId();
      const invalidations: Array<void | Promise<void>> = [];

      if (this.deps.invalidationCallbacks.clearSSRModuleCacheForProject && projectId) {
        invalidations.push(
          this.deps.invalidationCallbacks.clearSSRModuleCacheForProject(projectId),
        );
      } else {
        invalidations.push(this.deps.invalidationCallbacks.clearSSRModuleCache?.());
      }

      if (projectId) {
        if (this.deps.invalidationCallbacks.clearRouterDetectionCacheForProject) {
          invalidations.push(
            this.deps.invalidationCallbacks.clearRouterDetectionCacheForProject(projectId),
          );
        }
        if (this.deps.invalidationCallbacks.clearProjectDiscoveryCacheForProject) {
          invalidations.push(
            this.deps.invalidationCallbacks.clearProjectDiscoveryCacheForProject(projectId),
          );
        }
      }

      invalidations.push(this.deps.invalidationCallbacks.clearModulePathCache?.());

      if (this.deps.invalidationCallbacks.clearSnippetCacheForProject && this.deps.projectSlug) {
        invalidations.push(
          this.deps.invalidationCallbacks.clearSnippetCacheForProject(this.deps.projectSlug),
        );
      }

      if (this.deps.invalidationCallbacks.clearRendererCacheForProject && projectId) {
        invalidations.push(
          this.deps.invalidationCallbacks.clearRendererCacheForProject(projectId),
        );
      }

      // See the selective path: a branch poke clears the CSS caches after the
      // new snapshot is installed instead of here.
      if (contentContext?.sourceType !== "branch") {
        invalidations.push(this.clearProjectCSSCaches());
      }

      const pendingInvalidations = invalidations.filter(
        (invalidation): invalidation is Promise<void> => invalidation !== undefined,
      );
      if (pendingInvalidations.length > 0) {
        await Promise.all(pendingInvalidations);
      }

      const totalFileCount = fileBranchCount + fileReleaseCount + fileEnvCount;
      const totalStatCount = statBranchCount + statReleaseCount + statEnvCount;
      const totalDirCount = dirBranchCount + dirReleaseCount + dirEnvCount;
      const totalFilesListCount = filesBranchCount + filesReleaseCount + filesEnvCount;

      logger.debug("CACHES CLEARED (memory + Redis)", {
        fileCacheCleared: totalFileCount,
        statCacheCleared: totalStatCount,
        dirCacheCleared: totalDirCount,
        filesListCacheCleared: totalFilesListCount,
      });

      if (contentContext?.sourceType === "branch") {
        ({ preparedStyleArtifact, reloadSuperseded } = await this.refreshBranchSnapshot(
          contentContext,
          sourceSnapshotVersion,
          acceptedPokes,
          "full",
        ));
      }

      this.pokeMetrics.invalidationsTriggered++;
      cacheInvalidated = true;

      if (reloadSuperseded) {
        logger.debug("Skipping reload for superseded full invalidation", {
          projectSlug: this.deps.projectSlug,
        });
      } else {
        logger.info("TRIGGERING FULL BROWSER RELOAD via ReloadNotifier", {
          projectSlug: this.deps.projectSlug,
          projectId: this.deps.client.getProjectId(),
          hasTriggerReloadCallback: !!this.deps.invalidationCallbacks.triggerReload,
        });

        const projectContext = buildReloadProjectContext(
          contentContext,
          this.deps.projectSlug,
          this.deps.client.getProjectId(),
          preparedStyleArtifact,
        );

        void this.triggerReload(undefined, projectContext);
      }

      logger.debug("CACHE INVALIDATION COMPLETE", {
        fileCacheCleared: totalFileCount,
        statCacheCleared: totalStatCount,
        dirCacheCleared: totalDirCount,
        filesListCacheCleared: totalFilesListCount,
        durationMs: currentTime() - startTime,
        totalInvalidations: this.pokeMetrics.invalidationsTriggered,
      });
    } finally {
      if (cacheInvalidated) {
        this.sendPokeAck("full");
        this.completePreviewInvalidation(previewInvalidationToken);
        if (!reloadSuperseded) {
          this.deps.invalidationCallbacks.evictCurrentAdapter?.();
        }
      }
    }
  }

  private async triggerReload(
    changedPaths: string[] | undefined,
    projectContext: InvalidationProjectContext,
  ): Promise<void> {
    try {
      // Observe async failures without delaying completed cache invalidation.
      await this.deps.invalidationCallbacks.triggerReload?.(changedPaths, projectContext);
    } catch (error) {
      const kind = changedPaths === undefined ? "full" : "selective";
      logger.error(`Queued ${kind} invalidation failed`, {
        projectSlug: this.deps.projectSlug,
        error,
      });
    }
  }

  private startHeartbeat(projectId: string): void {
    this.wsHeartbeatTimer = setInterval(() => {
      const timeSinceLastPong = currentTime() - this.wsLastPong;
      if (timeSinceLastPong <= WS_HEARTBEAT_TIMEOUT_MS) return;

      logger.warn(
        "WebSocket heartbeat timeout, reconnecting",
        this.getConnectionLogContext({
          timeSinceLastPong,
        }),
      );

      // Detach onclose before closing to prevent double-reconnect:
      // ws.close() triggers onclose asynchronously, which would increment
      // the failure counter and schedule a separate reconnect timer.
      if (this.ws) {
        this.ws.onclose = null;
        try {
          this.ws.close();
        } catch (error) {
          logger.error("WebSocket close failed during heartbeat timeout", {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      this.cleanupTimers();
      this.connect(projectId);
    }, WS_HEARTBEAT_INTERVAL_MS);
  }

  private cleanupTimers(): void {
    if (this.wsHeartbeatTimer) {
      clearInterval(this.wsHeartbeatTimer);
      this.wsHeartbeatTimer = null;
    }

    if (this.wsReconnectTimer) {
      clearTimeout(this.wsReconnectTimer);
      this.wsReconnectTimer = null;
    }
  }

  private sendPokeAck(type: "selective" | "full", changedPaths?: string[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    try {
      this.ws.send(
        JSON.stringify({
          type: "poke_ack",
          data: {
            invalidationType: type,
            changedPaths: changedPaths ?? [],
            timestamp: currentTime(),
            connectionId: this.wsConnectionId,
            totalInvalidations: this.pokeMetrics.invalidationsTriggered,
          },
        }),
      );

      logger.debug("Poke acknowledgment sent", {
        type,
        changedPathsCount: changedPaths?.length ?? 0,
      });
    } catch (error) {
      logger.warn("Failed to send poke acknowledgment", { error });
    }
  }
}

import { getBaseLogger } from "#veryfront/utils/logger/logger.ts";
import { sanitizeUrlForSpan } from "#veryfront/utils/logger/redact.ts";
import type { FileCache } from "../cache/file-cache.ts";
import type { ProjectFile, VeryfrontApiClient } from "../../veryfront-api-client/index.ts";
import type {
  ContentSource,
  InvalidationCallbacks,
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
  WS_MAX_CHANGED_PATHS,
  WS_RECONNECT_MAX_FAILURES,
} from "./websocket-manager-helpers.ts";
import { runWithRequestContext } from "./request-context.ts";
import { PathNormalizer } from "./path-normalizer.ts";
import { collectParentDirectories } from "./stat-operations-helpers.ts";

const logger = getBaseLogger("SERVER", { injectTraceContext: false }).component(
  "web-socket-manager",
);

function sanitizeWebSocketLogUrl(url: string | undefined): string | undefined {
  return typeof url === "string" ? sanitizeUrlForSpan(url) : undefined;
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
  getContentSource: () => ContentSource;
  getProjectDir: () => string | undefined;
  clearMemoryCaches: () => void;
  replaceSourceSnapshot: (
    cacheKey: string,
    files: ProjectFile[],
  ) => Promise<void>;
  pregenerateStyles?: (
    files: ProjectFile[],
  ) => Promise<PreviewStyleArtifactInfo | undefined>;
}

interface WebSocketConnectionCredential {
  readonly projectId: string;
  readonly token: string;
}

const MAX_POKE_SCOPE_CODE_UNITS = 1_024;

function hasAsciiControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x1f || codeUnit === 0x7f) return true;
  }
  return false;
}

export class WebSocketManager {
  private ws: WebSocket | null = null;
  private wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private wsHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private wsLastPong = Date.now();
  private invalidationTimer: ReturnType<typeof setTimeout> | null = null;
  private selectiveInvalidationTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingChangedPaths = new Set<string>();

  private wsConnectionId: string | null = null;
  private wsConnectionGeneration = 0;
  private activeConnectionCredential: WebSocketConnectionCredential | null = null;
  private wsConsecutiveFailures = 0;
  private wsErrorLogged = false;
  private disposed = false;
  private invalidationGeneration = 0;
  private invalidationWorkVersion = 0;
  private activePreviewInvalidationPrefixes = new Set<string>();
  private pokeMetrics = {
    received: 0,
    invalidationsTriggered: 0,
    lastPokeTime: 0,
  };

  private apiToken: string;
  private readonly changedPathNormalizer: PathNormalizer;

  constructor(private readonly deps: WebSocketDeps) {
    this.apiToken = deps.apiToken;
    this.changedPathNormalizer = new PathNormalizer(deps.getProjectDir());
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

  private beginPreviewInvalidation(contentContext: ResolvedContentContext | null): void {
    this.invalidationWorkVersion++;
    const prefixes = this.getPreviewInvalidationPrefixes(contentContext);
    if (prefixes.length === 0) return;

    for (const prefix of prefixes) {
      if (this.activePreviewInvalidationPrefixes.has(prefix)) continue;
      addPendingInvalidation(prefix);
      this.activePreviewInvalidationPrefixes.add(prefix);
    }
  }

  private completePreviewInvalidation(prefixes: string[], workVersion: number): void {
    if (prefixes.length === 0) return;
    if (workVersion !== this.invalidationWorkVersion) return;

    for (const prefix of prefixes) {
      if (!this.activePreviewInvalidationPrefixes.delete(prefix)) continue;
      removePendingInvalidation(prefix);
    }
  }

  private releasePreviewInvalidations(): void {
    this.invalidationWorkVersion++;
    for (const prefix of this.activePreviewInvalidationPrefixes) {
      removePendingInvalidation(prefix);
    }
    this.activePreviewInvalidationPrefixes.clear();
  }

  private clearPendingInvalidationWork(): void {
    if (this.invalidationTimer) {
      clearTimeout(this.invalidationTimer);
      this.invalidationTimer = null;
    }

    if (this.selectiveInvalidationTimer) {
      clearTimeout(this.selectiveInvalidationTimer);
      this.selectiveInvalidationTimer = null;
    }

    this.pendingChangedPaths.clear();
  }

  private isInvalidationCurrent(generation: number): boolean {
    return !this.disposed && generation === this.invalidationGeneration;
  }

  private isInvalidationWorkCurrent(generation: number, workVersion: number): boolean {
    return this.isInvalidationCurrent(generation) &&
      workVersion === this.invalidationWorkVersion;
  }

  /**
   * Cancel work captured for the previous content source.
   *
   * Cache deletion already started for the old source may finish, but the
   * generation checks prevent that work from mutating, reloading, or evicting
   * the adapter after its context has changed.
   */
  onContentContextChanged(): void {
    if (this.disposed) return;
    this.invalidationGeneration++;
    this.clearPendingInvalidationWork();
    this.releasePreviewInvalidations();
  }

  private normalizeChangedPaths(rawChangedPaths: unknown): string[] | undefined {
    if (rawChangedPaths === undefined || rawChangedPaths === null) return undefined;
    if (!Array.isArray(rawChangedPaths)) {
      throw new TypeError("POKE payload.changedPaths must be an array of strings");
    }
    if (rawChangedPaths.length > WS_MAX_CHANGED_PATHS) {
      throw new RangeError(
        `POKE payload.changedPaths exceeds the ${WS_MAX_CHANGED_PATHS}-path limit`,
      );
    }

    const normalizedPaths = new Set<string>();
    for (const path of rawChangedPaths) {
      if (typeof path !== "string") {
        throw new TypeError("POKE payload.changedPaths must contain only strings");
      }
      const normalized = this.changedPathNormalizer.normalize(path);
      if (normalized.length === 0) {
        throw new TypeError("POKE payload.changedPaths must not contain empty paths");
      }
      normalizedPaths.add(normalized);
    }
    return Array.from(normalizedPaths);
  }

  private normalizeOptionalScope(
    value: unknown,
    fieldName: string,
  ): string | null | undefined {
    if (value === undefined || value === null) return value;
    if (typeof value !== "string") {
      throw new TypeError(`POKE payload.${fieldName} must be a string or null`);
    }
    if (value.length > MAX_POKE_SCOPE_CODE_UNITS) {
      throw new RangeError(
        `POKE payload.${fieldName} exceeds the ${MAX_POKE_SCOPE_CODE_UNITS}-character limit`,
      );
    }
    if (hasAsciiControlCharacter(value)) {
      throw new TypeError(`POKE payload.${fieldName} must not contain control characters`);
    }
    return value.length > 0 ? value : null;
  }

  private clearVolatileCaches(): void {
    let firstError: unknown;

    try {
      this.deps.invalidationCallbacks.clearDomainCache?.();
    } catch (error) {
      firstError = error;
    }

    try {
      this.deps.clearMemoryCaches();
    } catch (error) {
      firstError ??= error;
    }

    if (firstError !== undefined) throw firstError;
  }

  getPokeMetrics(): {
    received: number;
    invalidationsTriggered: number;
    lastPokeTime: number;
    connectionId: string | null;
  } {
    return { ...this.pokeMetrics, connectionId: this.wsConnectionId };
  }

  private buildWebSocketUrl(projectId: string): string {
    if (projectId.length === 0) throw new TypeError("WebSocket project ID must not be empty");

    const url = new URL(this.deps.apiBaseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new TypeError("WebSocket API base URL must use http: or https:");
    }

    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    // WebSocket authentication is carried by the bearer subprotocol. Never
    // propagate URL userinfo, query parameters, or fragments into the socket.
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";

    const basePath = url.pathname.replace(/\/+$/g, "").replace(/\/api$/g, "");
    url.pathname = `${basePath}/ws/${encodeURIComponent(projectId)}/events`;
    return url.toString();
  }

  private isCurrentConnection(socket: WebSocket, generation: number): boolean {
    return !this.disposed &&
      this.wsConnectionGeneration === generation &&
      this.ws === socket;
  }

  private detachSocket(socket: WebSocket): void {
    socket.onopen = null;
    socket.onmessage = null;
    socket.onclose = null;
    socket.onerror = null;
  }

  private closeSocket(socket: WebSocket, reason: string): void {
    this.detachSocket(socket);
    try {
      socket.close();
    } catch (error) {
      logger.warn("Error closing WebSocket", {
        reason,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private scheduleReconnect(
    credential: WebSocketConnectionCredential,
    generation: number,
    delay: number,
  ): void {
    this.wsReconnectTimer = setTimeout(() => {
      this.wsReconnectTimer = null;
      if (this.disposed || generation !== this.wsConnectionGeneration) return;
      this.connect(credential.projectId, credential.token);
    }, delay);
  }

  private recordConnectionFailure(): void {
    this.wsConsecutiveFailures = Math.min(
      WS_RECONNECT_MAX_FAILURES,
      this.wsConsecutiveFailures + 1,
    );
  }

  ensureConnected(projectId: string, apiToken: string): void {
    if (this.disposed) return;
    const currentCredential = this.activeConnectionCredential;
    const sameCredential = currentCredential?.projectId === projectId &&
      currentCredential.token === apiToken;
    const connectionAttemptActive = (
      this.ws !== null && this.ws.readyState !== WebSocket.CLOSED
    ) || this.wsReconnectTimer !== null;
    if (sameCredential && connectionAttemptActive) return;

    this.connect(projectId, apiToken);
  }

  /** Stop realtime delivery without permanently disposing the manager. */
  disconnect(): void {
    if (this.disposed) return;
    this.wsConnectionGeneration++;
    this.cleanupTimers();
    this.activeConnectionCredential = null;
    this.wsConsecutiveFailures = 0;
    this.wsErrorLogged = false;

    const socket = this.ws;
    this.ws = null;
    this.wsConnectionId = null;
    if (socket) this.closeSocket(socket, "disconnected");
  }

  connect(projectId: string, apiToken = this.apiToken): void {
    if (this.disposed) return;

    const credential: WebSocketConnectionCredential = Object.freeze({
      projectId,
      token: apiToken,
    });
    this.activeConnectionCredential = credential;
    const generation = ++this.wsConnectionGeneration;

    this.cleanupTimers();
    const previousSocket = this.ws;
    this.ws = null;
    this.wsConnectionId = null;
    if (previousSocket) {
      this.closeSocket(previousSocket, "superseded");
    }

    let socket: WebSocket | null = null;
    try {
      const url = this.buildWebSocketUrl(projectId);
      logger.debug(
        "Connecting to WebSocket",
        this.getConnectionLogContext({
          url: sanitizeWebSocketLogUrl(url),
          consecutiveFailures: this.wsConsecutiveFailures,
        }),
      );

      // Send the API token via a WebSocket subprotocol header instead of
      // a query-string parameter. Query strings can leak into server
      // access logs, proxy logs, and the browser's Referer header.
      const connectedSocket = new WebSocket(url, [`bearer-${credential.token}`]);
      socket = connectedSocket;
      const connectionId = crypto.randomUUID().slice(0, 8);
      this.ws = connectedSocket;
      this.wsConnectionId = connectionId;
      this.wsErrorLogged = false;

      connectedSocket.onopen = () => {
        if (!this.isCurrentConnection(connectedSocket, generation)) return;
        const recoveredFailures = this.wsConsecutiveFailures;
        this.wsConsecutiveFailures = 0;
        logger.debug(
          "WebSocket connected to events channel",
          this.getConnectionLogContext({
            projectId,
            connectionId,
            ...buildContentSourceLabel(this.deps.getContentSource, this.deps.getContentContext),
          }),
        );
        if (recoveredFailures > 0) {
          logger.info(
            "WebSocket reconnect recovered",
            this.getConnectionLogContext({
              projectId,
              project_id: projectId,
              connectionId,
              consecutiveFailures: recoveredFailures,
              ...buildContentSourceLabel(this.deps.getContentSource, this.deps.getContentContext),
            }),
          );
        }
        this.wsLastPong = Date.now();
        this.startHeartbeat(credential, connectedSocket, generation);
      };

      connectedSocket.onmessage = (event) => {
        if (!this.isCurrentConnection(connectedSocket, generation)) return;
        this.wsLastPong = Date.now();
        logger.debug("WebSocket message received", {
          dataType: typeof event.data,
          messageCodeUnits: typeof event.data === "string" ? event.data.length : undefined,
        });
        this.handlePokeMessage(event, credential);
      };

      connectedSocket.onclose = (event) => {
        if (!this.isCurrentConnection(connectedSocket, generation)) return;
        const closedUrl = connectedSocket.url;
        this.detachSocket(connectedSocket);
        this.ws = null;
        this.wsConnectionId = null;
        this.cleanupTimers();

        if (this.disposed) return;

        this.recordConnectionFailure();
        const delay = this.getReconnectDelay();
        logger.warn(
          "WebSocket reconnect scheduled after close",
          this.getConnectionLogContext({
            projectId,
            project_id: projectId,
            connectionId,
            url: sanitizeWebSocketLogUrl(closedUrl),
            delayMs: delay,
            totalPokesReceived: this.pokeMetrics.received,
            consecutiveFailures: this.wsConsecutiveFailures,
            closeCode: event.code,
            closeReason: event.reason,
            wasClean: event.wasClean,
          }),
        );
        this.scheduleReconnect(credential, generation, delay);
      };

      connectedSocket.onerror = (event) => {
        if (!this.isCurrentConnection(connectedSocket, generation)) return;
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
      if (socket) {
        if (this.ws === socket) {
          this.ws = null;
          this.wsConnectionId = null;
        }
        this.closeSocket(socket, "connection setup failed");
      }
      if (this.disposed || generation !== this.wsConnectionGeneration) return;

      this.recordConnectionFailure();
      const delay = this.getReconnectDelay();
      logger.warn(
        "Failed to connect WebSocket",
        this.getConnectionLogContext({
          error,
          consecutiveFailures: this.wsConsecutiveFailures,
          retryDelayMs: delay,
        }),
      );
      this.scheduleReconnect(credential, generation, delay);
    }
  }

  private getReconnectDelay(): number {
    // Exponential backoff: 5s, 10s, 20s, 40s, 80s, capped at 120s
    return getReconnectDelayHelper(this.wsConsecutiveFailures);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.wsConnectionGeneration++;
    this.invalidationGeneration++;
    this.cleanupTimers();
    this.clearPendingInvalidationWork();
    this.releasePreviewInvalidations();
    this.apiToken = "";
    this.activeConnectionCredential = null;

    const socket = this.ws;
    this.ws = null;
    this.wsConnectionId = null;
    if (socket) this.closeSocket(socket, "disposed");
  }

  private handlePokeMessage(
    event: MessageEvent,
    credential: WebSocketConnectionCredential,
  ): void {
    try {
      const message = parsePokeWebSocketMessage(event.data);
      if (!message) return;
      const payload = message.payload;
      const changedPaths = this.normalizeChangedPaths(payload.changedPaths);
      const contentContext = this.deps.getContentContext();
      if (!contentContext) {
        throw new Error("Cannot process a POKE before content context initialization");
      }

      const normalizedBranchId = this.normalizeOptionalScope(payload.branchId, "branchId") ?? null;
      const normalizedBranchName = this.normalizeOptionalScope(payload.branchName, "branchName") ??
        null;

      const timeSinceLastPoke = this.pokeMetrics.lastPokeTime > 0
        ? Date.now() - this.pokeMetrics.lastPokeTime
        : null;

      this.pokeMetrics.received++;
      this.pokeMetrics.lastPokeTime = Date.now();

      const isProductionMode = contentContext?.sourceType !== "branch";
      const currentBranch = contentContext?.branch ?? null;
      const hasBranchScope = !!normalizedBranchName || !!normalizedBranchId;
      const isProductionPoke = !hasBranchScope;

      logger.debug("POKE RECEIVED - checking environment scope", {
        type: message.type,
        pokeBranchId: normalizedBranchId,
        pokeBranchName: normalizedBranchName,
        isProductionPoke,
        isProductionMode,
        currentBranch,
        entityType: payload.entityType,
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
            pokeBranchId: normalizedBranchId,
            pokeBranchName: normalizedBranchName,
            sourceType: contentContext?.sourceType,
          },
        );
      }

      if (!isProductionMode) {
        if (normalizedBranchName && normalizedBranchName !== currentBranch) {
          logger.debug(
            "[WebSocketManager] POKE SKIPPED - different branch name in preview mode",
            {
              pokeBranchName: normalizedBranchName,
              currentBranch,
            },
          );
          return;
        }

        if (!normalizedBranchName && normalizedBranchId) {
          if (currentBranch === null) {
            logger.debug(
              "[WebSocketManager] POKE SKIPPED - branchId-only poke for main preview",
              { pokeBranchId: normalizedBranchId },
            );
            return;
          }

          logger.debug(
            "[WebSocketManager] POKE ACCEPTED - branchId-only fallback in preview mode",
            { pokeBranchId: normalizedBranchId, currentBranch },
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
            { currentBranch, defaultBranchName: this.deps.defaultBranchName ?? "main" },
          );
          return;
        }
      }

      const normalizedPokeReleaseId = this.normalizeOptionalScope(payload.releaseId, "releaseId") ??
        null;

      const isDeploymentPoke = payload.entityType === "deployment";
      const isPublishPoke = isDeploymentPoke || (isProductionMode && !changedPaths?.length);

      const normalizedPokeEnvironment =
        this.normalizeOptionalScope(payload.environmentName, "environmentName") ??
          contentContext.environmentName ??
          (isProductionMode ? "production" : undefined);

      logger.info("POKE ACCEPTED - triggering cache invalidation", {
        changedPathsCount: changedPaths?.length || 0,
        projectSlug: this.deps.projectSlug,
        branch: contentContext.branch,
        isDeploymentPoke,
        isPublishPoke,
        pokeReleaseId: normalizedPokeReleaseId,
        pokeEnvironmentName: normalizedPokeEnvironment,
      });

      this.beginPreviewInvalidation(contentContext);
      try {
        this.clearVolatileCaches();
      } catch (error) {
        logger.error("Immediate WebSocket cache invalidation failed; scheduled work will retry", {
          projectSlug: this.deps.projectSlug,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      logger.debug("Immediate in-memory cache invalidation attempted on POKE");

      if (isPublishPoke && this.deps.projectSlug) {
        this.clearPersistentCacheForPublish(normalizedPokeReleaseId, normalizedPokeEnvironment);
      }

      if (changedPaths?.length) {
        this.scheduleSelectiveInvalidation(changedPaths, credential);
        return;
      }

      logger.debug("No changedPaths provided - using full invalidation");
      this.scheduleInvalidation(credential);
    } catch (error) {
      logger.warn("Ignored invalid WebSocket POKE message", {
        error: error instanceof Error ? error.message : String(error),
      });
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
      addPrefixes([`file:${base}`, `stat:${base}`, `dir:${base}`, `files:${base}`]);
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
      releaseId,
      environmentName,
      deletionPrefixes: Array.from(deletionPrefixes),
      pendingPrefixes: Array.from(pendingPrefixes),
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
          releaseId,
          environmentName,
          totalDeleted,
        });
      } catch (error) {
        logger.error("PUBLISH POKE - failed to clear persistent cache (stale data may be served)", {
          projectSlug: this.deps.projectSlug,
          releaseId,
          environmentName,
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
              pendingPrefixes: Array.from(pendingPrefixes),
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

  private scheduleInvalidation(credential: WebSocketConnectionCredential): void {
    if (this.disposed) return;
    const invalidationGeneration = this.invalidationGeneration;
    if (this.invalidationTimer) clearTimeout(this.invalidationTimer);
    if (this.selectiveInvalidationTimer) {
      clearTimeout(this.selectiveInvalidationTimer);
      this.selectiveInvalidationTimer = null;
      this.pendingChangedPaths.clear();
    }

    logger.debug("Scheduling invalidation", {
      debounceMs: INVALIDATION_DEBOUNCE_MS,
    });

    this.invalidationTimer = setTimeout(() => {
      this.invalidationTimer = null;
      if (!this.isInvalidationCurrent(invalidationGeneration)) return;
      void this.runWithConnectionCredential(
        credential,
        () => this.performInvalidation(invalidationGeneration),
      ).catch((error) => {
        logger.error("Full WebSocket invalidation failed", {
          projectSlug: this.deps.projectSlug,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, INVALIDATION_DEBOUNCE_MS);
  }

  private scheduleSelectiveInvalidation(
    changedPaths: string[],
    credential: WebSocketConnectionCredential,
  ): void {
    if (this.disposed) return;
    const invalidationGeneration = this.invalidationGeneration;
    if (this.invalidationTimer) {
      logger.debug("Selective invalidation folded into pending full invalidation", {
        newPaths: changedPaths.length,
      });
      return;
    }

    for (const path of changedPaths) this.pendingChangedPaths.add(path);

    if (this.selectiveInvalidationTimer) clearTimeout(this.selectiveInvalidationTimer);

    logger.debug("Scheduling selective invalidation", {
      newPaths: changedPaths.length,
      totalPending: this.pendingChangedPaths.size,
      debounceMs: INVALIDATION_DEBOUNCE_MS,
    });

    this.selectiveInvalidationTimer = setTimeout(() => {
      this.selectiveInvalidationTimer = null;
      if (!this.isInvalidationCurrent(invalidationGeneration)) {
        this.pendingChangedPaths.clear();
        return;
      }
      void this.runWithConnectionCredential(
        credential,
        () => this.performSelectiveInvalidation(invalidationGeneration),
      ).catch((error) => {
        logger.error("Selective WebSocket invalidation failed", {
          projectSlug: this.deps.projectSlug,
          pendingChangedPathsCount: this.pendingChangedPaths.size,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, INVALIDATION_DEBOUNCE_MS);
  }

  private async performSelectiveInvalidation(invalidationGeneration: number): Promise<void> {
    if (!this.isInvalidationCurrent(invalidationGeneration)) return;
    const startTime = Date.now();
    const changedPaths = Array.from(this.pendingChangedPaths);
    this.pendingChangedPaths.clear();

    const contentContext = this.deps.getContentContext();
    if (!contentContext || changedPaths.length === 0) return;
    const previewInvalidationPrefixes = this.getPreviewInvalidationPrefixes(contentContext);
    const invalidationWorkVersion = this.invalidationWorkVersion;
    let preparedStyleArtifact: PreviewStyleArtifactInfo | undefined;
    let succeeded = false;

    try {
      logger.debug("Performing selective invalidation", {
        changedPaths,
        count: changedPaths.length,
      });

      const parentDirs = new Set<string>();
      const deletionPromises: Array<Promise<boolean | number>> = [];
      const filePrefix = buildFileCacheKeyPrefix(contentContext);
      const statPrefix = buildStatCacheKeyPrefix(contentContext);
      const dirPrefix = buildDirCacheKeyPrefix(contentContext);

      for (const path of changedPaths) {
        parentDirs.add("");
        for (const parentDir of collectParentDirectories(path)) {
          parentDirs.add(parentDir);
        }
        deletionPromises.push(
          this.deps.cache.deleteAsync(`${filePrefix}:${path}`),
          this.deps.cache.deleteAsync(`${statPrefix}:${path}`),
        );
      }

      for (const parentDir of parentDirs) {
        deletionPromises.push(this.deps.cache.deleteAsync(`${dirPrefix}:${parentDir}`));
      }
      deletionPromises.push(this.deps.cache.deleteAsync(buildFileListCacheKey(contentContext)));
      deletionPromises.push(this.deps.cache.deleteByPrefixAsync(`${statPrefix}:resolve:`));

      await Promise.all(deletionPromises);
      if (!this.isInvalidationWorkCurrent(invalidationGeneration, invalidationWorkVersion)) return;
      this.clearVolatileCaches();

      logger.debug("Cache entries deleted for changed paths", {
        changedPathsCount: changedPaths.length,
        parentDirs: Array.from(parentDirs),
        filePrefix,
        statPrefix,
        dirPrefix,
      });

      const projectId = this.deps.client.getProjectId();
      const invalidations: Array<void | Promise<void>> = [
        this.deps.invalidationCallbacks.invalidateModulePaths?.(changedPaths),
      ];
      logger.debug("Clearing SSR module cache for HMR", {
        changedPaths,
        projectId,
        usePerProject: !!this.deps.invalidationCallbacks.clearSSRModuleCacheForProject,
      });

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

      if (this.deps.invalidationCallbacks.clearRendererCacheForProject && projectId) {
        invalidations.push(
          this.deps.invalidationCallbacks.clearRendererCacheForProject(projectId),
        );
      }

      if (this.deps.invalidationCallbacks.clearProjectCSSCache && this.deps.projectSlug) {
        invalidations.push(
          this.deps.invalidationCallbacks.clearProjectCSSCache(this.deps.projectSlug),
        );
      }

      const pendingInvalidations = invalidations.filter(
        (invalidation): invalidation is Promise<void> => invalidation !== undefined,
      );
      if (pendingInvalidations.length > 0) {
        await Promise.all(pendingInvalidations);
      }
      if (!this.isInvalidationWorkCurrent(invalidationGeneration, invalidationWorkVersion)) return;

      if (contentContext.sourceType === "branch") {
        try {
          const files = await this.deps.client.listAllFiles();
          if (
            !this.isInvalidationWorkCurrent(invalidationGeneration, invalidationWorkVersion)
          ) return;
          const cacheKey = buildFileListCacheKey(contentContext);
          await this.deps.replaceSourceSnapshot(cacheKey, files);
          if (
            !this.isInvalidationWorkCurrent(invalidationGeneration, invalidationWorkVersion)
          ) return;
          preparedStyleArtifact = await this.deps.pregenerateStyles?.(files);
          if (
            !this.isInvalidationWorkCurrent(invalidationGeneration, invalidationWorkVersion)
          ) return;

          logger.debug("Fresh files cached (local + shared)", {
            cacheKey,
            fileCount: files.length,
            styleAssetPath: preparedStyleArtifact?.assetPath,
          });
        } catch (error) {
          logger.warn("Failed to fetch files during selective invalidation", {
            error,
          });
        }
      }
      if (!this.isInvalidationWorkCurrent(invalidationGeneration, invalidationWorkVersion)) return;

      this.pokeMetrics.invalidationsTriggered++;

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

      this.deps.invalidationCallbacks.triggerReload?.(changedPaths, projectContext);
      if (!this.isInvalidationWorkCurrent(invalidationGeneration, invalidationWorkVersion)) return;

      logger.info("Selective invalidation complete - HMR triggered", {
        changedPathsCount: changedPaths.length,
        durationMs: Date.now() - startTime,
        totalInvalidations: this.pokeMetrics.invalidationsTriggered,
      });

      this.sendPokeAck("selective", changedPaths);
      succeeded = true;
    } finally {
      if (
        succeeded &&
        this.isInvalidationWorkCurrent(invalidationGeneration, invalidationWorkVersion)
      ) {
        this.completePreviewInvalidation(
          previewInvalidationPrefixes,
          invalidationWorkVersion,
        );
        this.deps.invalidationCallbacks.evictCurrentAdapter?.();
      }
    }
  }

  private async performInvalidation(invalidationGeneration: number): Promise<void> {
    if (!this.isInvalidationCurrent(invalidationGeneration)) return;
    const startTime = Date.now();
    const contentContext = this.deps.getContentContext();
    if (!contentContext) return;
    const previewInvalidationPrefixes = this.getPreviewInvalidationPrefixes(contentContext);
    const invalidationWorkVersion = this.invalidationWorkVersion;
    let preparedStyleArtifact: PreviewStyleArtifactInfo | undefined;
    let succeeded = false;

    try {
      logger.debug("CACHE INVALIDATION STARTED - clearing project source caches");

      const filePrefix = buildFileCacheKeyPrefix(contentContext);
      const statPrefix = buildStatCacheKeyPrefix(contentContext);
      const dirPrefix = buildDirCacheKeyPrefix(contentContext);
      const fileListKey = buildFileListCacheKey(contentContext);
      const [fileCount, statCount, dirCount, fileListDeleted] = await Promise.all([
        this.deps.cache.deleteByPrefixAsync(`${filePrefix}:`),
        this.deps.cache.deleteByPrefixAsync(`${statPrefix}:`),
        this.deps.cache.deleteByPrefixAsync(`${dirPrefix}:`),
        this.deps.cache.deleteAsync(fileListKey),
      ]);
      if (!this.isInvalidationWorkCurrent(invalidationGeneration, invalidationWorkVersion)) return;

      // These caches are also cleared immediately on POKE receipt (before debounce).
      // These calls are redundant safety nets for the full invalidation flow.
      this.clearVolatileCaches();

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

      if (this.deps.invalidationCallbacks.clearProjectCSSCache && this.deps.projectSlug) {
        invalidations.push(
          this.deps.invalidationCallbacks.clearProjectCSSCache(this.deps.projectSlug),
        );
      }

      const pendingInvalidations = invalidations.filter(
        (invalidation): invalidation is Promise<void> => invalidation !== undefined,
      );
      if (pendingInvalidations.length > 0) {
        await Promise.all(pendingInvalidations);
      }
      if (!this.isInvalidationWorkCurrent(invalidationGeneration, invalidationWorkVersion)) return;

      const fileListCount = fileListDeleted ? 1 : 0;

      logger.debug("CACHES CLEARED (local + shared)", {
        fileCacheCleared: fileCount,
        statCacheCleared: statCount,
        dirCacheCleared: dirCount,
        filesListCacheCleared: fileListCount,
        filePrefix,
        statPrefix,
        dirPrefix,
      });

      if (contentContext.sourceType === "branch") {
        try {
          const files = await this.deps.client.listAllFiles();
          if (
            !this.isInvalidationWorkCurrent(invalidationGeneration, invalidationWorkVersion)
          ) return;
          const cacheKey = buildFileListCacheKey(contentContext);
          await this.deps.replaceSourceSnapshot(cacheKey, files);
          if (
            !this.isInvalidationWorkCurrent(invalidationGeneration, invalidationWorkVersion)
          ) return;
          preparedStyleArtifact = await this.deps.pregenerateStyles?.(files);
          if (
            !this.isInvalidationWorkCurrent(invalidationGeneration, invalidationWorkVersion)
          ) return;

          logger.debug("FRESH FILES FETCHED", {
            cacheKey,
            fileCount: files.length,
            styleAssetPath: preparedStyleArtifact?.assetPath,
          });
        } catch (error) {
          logger.warn("Failed to fetch files during invalidation", { error });
        }
      }
      if (!this.isInvalidationWorkCurrent(invalidationGeneration, invalidationWorkVersion)) return;

      this.pokeMetrics.invalidationsTriggered++;

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

      this.deps.invalidationCallbacks.triggerReload?.(undefined, projectContext);
      if (!this.isInvalidationWorkCurrent(invalidationGeneration, invalidationWorkVersion)) return;

      logger.debug("CACHE INVALIDATION COMPLETE", {
        fileCacheCleared: fileCount,
        statCacheCleared: statCount,
        dirCacheCleared: dirCount,
        filesListCacheCleared: fileListCount,
        durationMs: Date.now() - startTime,
        totalInvalidations: this.pokeMetrics.invalidationsTriggered,
      });

      this.sendPokeAck("full");
      succeeded = true;
    } finally {
      if (
        succeeded &&
        this.isInvalidationWorkCurrent(invalidationGeneration, invalidationWorkVersion)
      ) {
        this.completePreviewInvalidation(
          previewInvalidationPrefixes,
          invalidationWorkVersion,
        );
        this.deps.invalidationCallbacks.evictCurrentAdapter?.();
      }
    }
  }

  private runWithConnectionCredential<T>(
    credential: WebSocketConnectionCredential,
    fn: () => Promise<T>,
  ): Promise<T> {
    const contentContext = this.deps.getContentContext();
    const productionMode = contentContext !== null && contentContext.sourceType !== "branch";

    return runWithRequestContext(
      {
        projectSlug: this.deps.projectSlug,
        projectId: credential.projectId,
        token: credential.token,
        productionMode,
        releaseId: productionMode ? contentContext?.releaseId ?? null : null,
        branch: productionMode ? null : contentContext?.branch ?? null,
        environmentName: contentContext?.environmentName ?? null,
        tokenProvenance: "project-bound",
      },
      fn,
    );
  }

  private startHeartbeat(
    credential: WebSocketConnectionCredential,
    socket: WebSocket,
    generation: number,
  ): void {
    this.wsHeartbeatTimer = setInterval(() => {
      if (!this.isCurrentConnection(socket, generation)) return;
      const timeSinceLastPong = Date.now() - this.wsLastPong;
      if (timeSinceLastPong <= WS_HEARTBEAT_TIMEOUT_MS) return;

      logger.warn(
        "WebSocket heartbeat timeout, reconnecting",
        this.getConnectionLogContext({
          timeSinceLastPong,
        }),
      );

      this.cleanupTimers();
      this.ws = null;
      this.wsConnectionId = null;
      this.closeSocket(socket, "heartbeat timeout");
      this.connect(credential.projectId, credential.token);
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
            timestamp: Date.now(),
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

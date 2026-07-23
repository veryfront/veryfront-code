import { RateLimiter } from "#veryfront/modules/server/index.ts";
import { HMR_MAX_MESSAGES_PER_MINUTE, serverLogger } from "#veryfront/utils";
import { invalidateProjectCaches } from "../../context/cache-invalidation.ts";
import { ReloadNotifier, type ReloadProjectInfo } from "../../reload-notifier.ts";
import { clearAll, getClientCount } from "./hmr-client-manager.ts";
import { broadcastUpdate, resetMetrics } from "./hmr-message-router.ts";
import { getPingIntervalMs, startPingInterval, stopPingInterval } from "./hmr-ping-keepalive.ts";

const logger = serverLogger.component("hmr-handler");
type ReloadListener = (changedPaths?: string[], project?: ReloadProjectInfo) => void;
type InvalidationListener = (project?: ReloadProjectInfo) => void | Promise<void>;

export interface HmrRuntimeDependencies {
  broadcast: ReloadListener;
  clearClients(): void;
  clientCount(): number;
  createRateLimiter(): RateLimiter;
  invalidate(
    projectSlug: string,
    changedPaths?: string[],
    options?: {
      projectId?: string;
      environment?: "preview" | "production";
      branchId?: string | null;
    },
  ): Promise<void>;
  pingIntervalMs(): number;
  resetMetrics(): void;
  startPing(afterSweep: () => void): void;
  stopPing(): void;
  subscribe(listener: ReloadListener): () => void;
  subscribeInvalidation(listener: InvalidationListener): () => void;
}

export class HmrRuntimeController {
  #rateLimiter: RateLimiter;
  #invalidationUnsubscribe: (() => void) | null = null;
  #reloadUnsubscribe: (() => void) | null = null;
  #runtimeLeaseCount = 0;
  #initialized = false;

  constructor(private readonly deps: HmrRuntimeDependencies) {
    this.#rateLimiter = deps.createRateLimiter();
  }

  get rateLimiter(): RateLimiter {
    return this.#rateLimiter;
  }

  initialize(): void {
    if (this.#initialized) return;
    this.#initialized = true;
    logger.info("Subscribing to ReloadNotifier");
    this.#invalidationUnsubscribe = this.deps.subscribeInvalidation(async (project) => {
      const projectSlug = project?.projectSlug ?? project?.projectId;
      if (!projectSlug) return;
      await this.deps.invalidate(projectSlug, undefined, {
        projectId: project?.projectId,
        environment: project?.environment,
        branchId: project?.branch ?? undefined,
      });
    });
    this.#reloadUnsubscribe = this.deps.subscribe((changedPaths, project) => {
      logger.debug("ReloadNotifier callback triggered", {
        changedPathCount: changedPaths?.length ?? 0,
        clientCount: this.deps.clientCount(),
      });
      this.deps.broadcast(changedPaths, project);
      this.teardownIfUnused();
    });
    this.deps.startPing(() => this.teardownIfUnused());
    logger.debug("Initialized - listening for reload events", {
      pingIntervalMs: this.deps.pingIntervalMs(),
    });
  }

  acquire(): () => void {
    this.initialize();
    this.#runtimeLeaseCount++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#runtimeLeaseCount = Math.max(0, this.#runtimeLeaseCount - 1);
      this.teardownIfUnused();
    };
  }

  teardownIfUnused(): void {
    if (this.#runtimeLeaseCount === 0 && this.deps.clientCount() === 0) this.teardown();
  }

  shutdown(): void {
    this.#runtimeLeaseCount = 0;
    this.teardown();
  }

  private teardown(): void {
    this.#invalidationUnsubscribe?.();
    this.#invalidationUnsubscribe = null;
    this.#reloadUnsubscribe?.();
    this.#reloadUnsubscribe = null;
    this.deps.stopPing();
    this.deps.clearClients();
    this.#rateLimiter = this.deps.createRateLimiter();
    this.deps.resetMetrics();
    this.#initialized = false;
    logger.debug("Shutdown complete");
  }
}

const runtimeController = new HmrRuntimeController({
  broadcast: broadcastUpdate,
  clearClients: clearAll,
  clientCount: getClientCount,
  createRateLimiter: () => new RateLimiter(HMR_MAX_MESSAGES_PER_MINUTE),
  invalidate: invalidateProjectCaches,
  pingIntervalMs: getPingIntervalMs,
  resetMetrics,
  startPing: startPingInterval,
  stopPing: stopPingInterval,
  subscribe: (listener) => ReloadNotifier.subscribe(listener),
  subscribeInvalidation: (listener) => ReloadNotifier.subscribeInvalidate(listener),
});

export function getHmrRateLimiter(): RateLimiter {
  return runtimeController.rateLimiter;
}
export function initializeHmrRuntime(): void {
  runtimeController.initialize();
}
export function acquireHmrRuntime(): () => void {
  return runtimeController.acquire();
}
export function teardownHmrRuntimeIfUnused(): void {
  runtimeController.teardownIfUnused();
}
export function shutdownHmrRuntime(): void {
  runtimeController.shutdown();
}

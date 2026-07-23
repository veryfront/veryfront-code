import { serverLogger } from "#veryfront/utils";
import { registerProcessStateReset } from "#veryfront/platform/compat/process/state-reset.ts";
import { getSafeErrorName } from "./utils/error-name.ts";
import { hasUnsafeControlCharacters } from "#veryfront/errors/text-validation.ts";

const logger = serverLogger.component("reload-notifier");
const MAX_RELOAD_LISTENERS = 10_000;
const MAX_ACTIVE_PROJECT_RELOADS = 1_024;
const MAX_CHANGED_PATHS = 4_096;
const MAX_CHANGED_PATH_LENGTH = 4_096;
const MAX_CHANGED_PATH_BYTES = 4_096;
const MAX_CHANGED_PATH_TOTAL_BYTES = 4 * 1_024 * 1_024;
const MAX_PROJECT_IDENTITY_LENGTH = 512;
const MAX_PROJECT_PATH_LENGTH = 4_096;
const textEncoder = new TextEncoder();

export interface ReloadProjectInfo {
  projectSlug?: string;
  projectId?: string;
  projectDir?: string;
  environment?: "preview" | "production";
  branch?: string | null;
  releaseId?: string | null;
  styleArtifactHash?: string;
  styleAssetPath?: string;
}

type ReloadListener = (changedPaths?: string[], project?: ReloadProjectInfo) => void;
type InvalidateListener = (project?: ReloadProjectInfo) => void | Promise<void>;
type ReloadProjectInput = ReloadProjectInfo | string | undefined;

const DEBOUNCE_MS = 300;

interface PendingReload {
  changedPaths: Set<string>;
  fullInvalidation: boolean;
  project?: ReloadProjectInfo;
  timer: ReturnType<typeof setTimeout>;
}

interface NormalizedChangedPaths {
  paths?: string[];
  fullInvalidation: boolean;
}

function saturatingIncrement(value: number): number {
  return Math.min(Number.MAX_SAFE_INTEGER, value + 1);
}

function normalizeChangedPaths(changedPaths: string[] | undefined): NormalizedChangedPaths {
  if (changedPaths === undefined) return { fullInvalidation: true };
  if (!Array.isArray(changedPaths)) throw new TypeError("Reload paths must be an array");
  if (changedPaths.length === 0) return { fullInvalidation: true };
  if (changedPaths.length > MAX_CHANGED_PATHS) return { fullInvalidation: true };

  const paths = new Set<string>();
  let totalBytes = 0;
  for (const path of changedPaths) {
    if (
      typeof path !== "string" || path.length === 0 || path.length > MAX_CHANGED_PATH_LENGTH ||
      hasUnsafeControlCharacters(path)
    ) {
      return { fullInvalidation: true };
    }
    const byteLength = textEncoder.encode(path).byteLength;
    totalBytes += byteLength;
    if (byteLength > MAX_CHANGED_PATH_BYTES || totalBytes > MAX_CHANGED_PATH_TOTAL_BYTES) {
      return { fullInvalidation: true };
    }
    paths.add(path);
  }
  return { paths: [...paths], fullInvalidation: false };
}

function normalizeMetadataString(
  value: unknown,
  maxLength: number,
  nullable?: false,
): string | undefined;
function normalizeMetadataString(
  value: unknown,
  maxLength: number,
  nullable: true,
): string | null | undefined;
function normalizeMetadataString(
  value: unknown,
  maxLength: number,
  nullable = false,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (nullable && value === null) return null;
  if (
    typeof value !== "string" || value.length === 0 || value.length > maxLength ||
    hasUnsafeControlCharacters(value)
  ) {
    throw new TypeError("Reload project metadata is invalid");
  }
  return value;
}

function projectBatchKey(project?: ReloadProjectInfo): string {
  if (!project) return "global";
  return JSON.stringify([
    project.projectId ?? null,
    project.projectSlug ?? null,
    project.projectDir ?? null,
    project.environment ?? null,
    project.branch ?? null,
    project.releaseId ?? null,
  ]);
}

function projectLogContext(project?: ReloadProjectInfo): Record<string, unknown> | undefined {
  if (!project) return undefined;
  return {
    scoped: true,
    environment: project.environment === "production"
      ? "production"
      : project.environment === "preview"
      ? "preview"
      : "unknown",
    hasBranch: typeof project.branch === "string" && project.branch.length > 0,
    hasRelease: typeof project.releaseId === "string" && project.releaseId.length > 0,
  };
}

class ReloadNotifierImpl {
  private listeners = new Set<ReloadListener>();
  private invalidateListeners = new Set<InvalidateListener>();
  private pendingReloads = new Map<string, PendingReload>();
  private invalidationChains = new Map<string, Promise<void>>();
  private generation = 0;
  private metrics = {
    triggerCalls: 0,
    broadcastsSent: 0,
    lastTriggerTime: 0,
  };

  subscribe(listener: ReloadListener): () => void {
    if (!this.listeners.has(listener) && this.listeners.size >= MAX_RELOAD_LISTENERS) {
      throw new RangeError("Reload listener capacity reached");
    }
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  subscribeInvalidate(listener: InvalidateListener): () => void {
    if (
      !this.invalidateListeners.has(listener) &&
      this.invalidateListeners.size >= MAX_RELOAD_LISTENERS
    ) {
      throw new RangeError("Reload invalidation listener capacity reached");
    }
    this.invalidateListeners.add(listener);
    return () => this.invalidateListeners.delete(listener);
  }

  async triggerReload(changedPaths?: string[], project?: ReloadProjectInput): Promise<void> {
    this.metrics.triggerCalls = saturatingIncrement(this.metrics.triggerCalls);
    this.metrics.lastTriggerTime = Date.now();

    const projectInfo = normalizeProjectInfo(project);
    const normalizedPaths = normalizeChangedPaths(changedPaths);
    const key = projectBatchKey(projectInfo);
    if (!this.hasActiveReloadCapacity(key)) {
      throw new RangeError("Active project reload capacity reached");
    }
    const generation = this.generation;
    const invalidateListeners = [...this.invalidateListeners];

    logger.info("triggerReload called", {
      invalidateListeners: this.invalidateListeners.size,
      reloadListeners: this.listeners.size,
      changedPathCount: normalizedPaths.paths?.length ?? 0,
      fullInvalidation: normalizedPaths.fullInvalidation,
      project: projectLogContext(projectInfo),
    });

    const previousInvalidation = this.invalidationChains.get(key) ?? Promise.resolve();
    const invalidationResult = previousInvalidation.then(
      () =>
        generation === this.generation
          ? this.notifyInvalidateListeners(invalidateListeners, projectInfo)
          : false,
      () =>
        generation === this.generation
          ? this.notifyInvalidateListeners(invalidateListeners, projectInfo)
          : false,
    );
    const invalidationChain = invalidationResult.then(() => undefined);
    this.invalidationChains.set(key, invalidationChain);

    await invalidationResult.then((succeeded) => {
      if (generation !== this.generation || !succeeded) return;
      this.scheduleReload(key, normalizedPaths, projectInfo);
    }).finally(() => {
      if (this.invalidationChains.get(key) === invalidationChain) {
        this.invalidationChains.delete(key);
      }
    });
  }

  private hasActiveReloadCapacity(key: string): boolean {
    if (this.invalidationChains.has(key) || this.pendingReloads.has(key)) return true;
    const activeKeys = new Set(this.invalidationChains.keys());
    for (const pendingKey of this.pendingReloads.keys()) activeKeys.add(pendingKey);
    return activeKeys.size < MAX_ACTIVE_PROJECT_RELOADS;
  }

  private scheduleReload(
    key: string,
    changedPaths: NormalizedChangedPaths,
    project: ReloadProjectInfo | undefined,
  ): void {
    const existing = this.pendingReloads.get(key);
    if (existing) clearTimeout(existing.timer);
    if (!existing && this.pendingReloads.size >= MAX_ACTIVE_PROJECT_RELOADS) {
      throw new RangeError("Pending project reload capacity reached");
    }

    const pending: PendingReload = {
      changedPaths: existing?.changedPaths ?? new Set<string>(),
      fullInvalidation: existing?.fullInvalidation === true || changedPaths.fullInvalidation,
      project,
      timer: setTimeout(() => this.flushPendingReload(key), DEBOUNCE_MS),
    };
    if (pending.fullInvalidation) {
      pending.changedPaths.clear();
    } else {
      for (const path of changedPaths.paths ?? []) pending.changedPaths.add(path);
    }
    this.pendingReloads.set(key, pending);
  }

  private flushPendingReload(key: string): void {
    const pending = this.pendingReloads.get(key);
    if (!pending) return;
    this.pendingReloads.delete(key);
    const paths = pending.fullInvalidation ? undefined : Array.from(pending.changedPaths);

    logger.debug("Debounce complete, notifying reload listeners", {
      listenerCount: this.listeners.size,
      changedPathCount: paths?.length ?? 0,
      project: projectLogContext(pending.project),
    });
    this.notifyListeners(paths, pending.project);
  }

  private async notifyInvalidateListeners(
    listeners: InvalidateListener[],
    project?: ReloadProjectInfo,
  ): Promise<boolean> {
    logger.debug("Notifying invalidate listeners", {
      count: listeners.length,
    });

    let succeeded = true;
    await Promise.all(listeners.map(async (listener) => {
      try {
        await listener(project);
      } catch (error) {
        succeeded = false;
        logger.error("Invalidate listener failed", {
          errorName: getSafeErrorName(error),
        });
      }
    }));
    return succeeded;
  }

  private notifyListeners(changedPaths?: string[], project?: ReloadProjectInfo): void {
    this.metrics.broadcastsSent = saturatingIncrement(this.metrics.broadcastsSent);

    logger.debug("Notifying reload listeners", {
      count: this.listeners.size,
      changedPathCount: changedPaths?.length ?? 0,
      project: projectLogContext(project),
    });

    for (const listener of this.listeners) {
      try {
        listener(changedPaths, project);
      } catch (error) {
        logger.error("Reload listener failed", {
          errorName: getSafeErrorName(error),
        });
      }
    }
  }

  getListenerCount(): number {
    return this.listeners.size;
  }

  getInvalidateListenerCount(): number {
    return this.invalidateListeners.size;
  }

  getMetrics(): {
    triggerCalls: number;
    broadcastsSent: number;
    lastTriggerTime: number;
    activeReloadListeners: number;
    activeInvalidateListeners: number;
  } {
    return {
      ...this.metrics,
      activeReloadListeners: this.listeners.size,
      activeInvalidateListeners: this.invalidateListeners.size,
    };
  }

  reset(): void {
    this.generation++;
    this.listeners.clear();
    this.invalidateListeners.clear();

    for (const pending of this.pendingReloads.values()) clearTimeout(pending.timer);
    this.pendingReloads.clear();
    this.invalidationChains.clear();
    this.metrics = {
      triggerCalls: 0,
      broadcastsSent: 0,
      lastTriggerTime: 0,
    };
  }
}

/** Render reload notifier. */
export const ReloadNotifier = new ReloadNotifierImpl();

registerProcessStateReset("reload notifier", () => ReloadNotifier.reset());

function normalizeProjectInfo(project?: ReloadProjectInput): ReloadProjectInfo | undefined {
  if (project === undefined) return undefined;
  if (typeof project === "string") {
    return {
      projectSlug: normalizeMetadataString(project, MAX_PROJECT_IDENTITY_LENGTH),
    };
  }
  if (typeof project !== "object") throw new TypeError("Reload project metadata is invalid");

  const result: ReloadProjectInfo = {};
  const projectSlug = normalizeMetadataString(project.projectSlug, MAX_PROJECT_IDENTITY_LENGTH);
  const projectId = normalizeMetadataString(project.projectId, MAX_PROJECT_IDENTITY_LENGTH);
  const projectDir = normalizeMetadataString(project.projectDir, MAX_PROJECT_PATH_LENGTH);
  const branch = normalizeMetadataString(project.branch, MAX_PROJECT_IDENTITY_LENGTH, true);
  const releaseId = normalizeMetadataString(project.releaseId, MAX_PROJECT_IDENTITY_LENGTH, true);
  const styleArtifactHash = normalizeMetadataString(
    project.styleArtifactHash,
    MAX_PROJECT_IDENTITY_LENGTH,
  );
  const styleAssetPath = normalizeMetadataString(project.styleAssetPath, MAX_PROJECT_PATH_LENGTH);
  if (
    project.environment !== undefined && project.environment !== "preview" &&
    project.environment !== "production"
  ) {
    throw new TypeError("Reload project metadata is invalid");
  }

  if (projectSlug !== undefined) result.projectSlug = projectSlug;
  if (projectId !== undefined) result.projectId = projectId;
  if (projectDir !== undefined) result.projectDir = projectDir;
  if (project.environment !== undefined) result.environment = project.environment;
  if (branch !== undefined) result.branch = branch;
  if (releaseId !== undefined) result.releaseId = releaseId;
  if (styleArtifactHash !== undefined) result.styleArtifactHash = styleArtifactHash;
  if (styleAssetPath !== undefined) result.styleAssetPath = styleAssetPath;
  return result;
}

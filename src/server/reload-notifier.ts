import { serverLogger } from "#veryfront/utils";
import { createSubscriberSet } from "#veryfront/utils/subscriber-set.ts";

const logger = serverLogger.component("reload-notifier");

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
type InvalidateListener = () => void;
type ReloadProjectInput = ReloadProjectInfo | string | undefined;

const DEBOUNCE_MS = 300;

class ReloadNotifierImpl {
  private listeners = createSubscriberSet<[string[] | undefined, ReloadProjectInfo | undefined]>(
    (error) => logger.error("Listener error:", error),
  );
  private invalidateListeners = createSubscriberSet(
    (error) => logger.error("Invalidate listener error:", error),
  );
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingChangedPaths = new Set<string>();
  private pendingProject?: ReloadProjectInfo;
  private metrics = {
    triggerCalls: 0,
    broadcastsSent: 0,
    lastTriggerTime: 0,
  };

  subscribe(listener: ReloadListener): () => void {
    return this.listeners.subscribe(listener);
  }

  subscribeInvalidate(listener: InvalidateListener): () => void {
    return this.invalidateListeners.subscribe(listener);
  }

  triggerReload(changedPaths?: string[], project?: ReloadProjectInput): void {
    this.metrics.triggerCalls++;
    this.metrics.lastTriggerTime = Date.now();

    const projectInfo = normalizeProjectInfo(project);

    logger.info("triggerReload called", {
      invalidateListeners: this.invalidateListeners.size,
      reloadListeners: this.listeners.size,
      changedPaths,
      project: projectInfo,
    });

    for (const path of changedPaths ?? []) this.pendingChangedPaths.add(path);
    if (projectInfo) this.pendingProject = projectInfo;

    this.notifyInvalidateListeners();

    if (this.debounceTimer) clearTimeout(this.debounceTimer);

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;

      const paths = this.pendingChangedPaths.size > 0
        ? Array.from(this.pendingChangedPaths)
        : undefined;
      const pendingProject = this.pendingProject;

      this.pendingChangedPaths.clear();
      this.pendingProject = undefined;

      logger.debug("Debounce complete, notifying reload listeners", {
        listenerCount: this.listeners.size,
        changedPaths: paths,
        project: pendingProject,
      });

      this.notifyListeners(paths, pendingProject);
    }, DEBOUNCE_MS);
  }

  private notifyInvalidateListeners(): void {
    logger.debug("Notifying invalidate listeners", {
      count: this.invalidateListeners.size,
    });

    this.invalidateListeners.notify();
  }

  private notifyListeners(changedPaths?: string[], project?: ReloadProjectInfo): void {
    this.metrics.broadcastsSent++;

    logger.debug("Notifying reload listeners", {
      count: this.listeners.size,
      changedPaths,
      project,
    });

    this.listeners.notify(changedPaths, project);
  }

  getListenerCount(): number {
    return this.listeners.size;
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
    this.listeners.clear();
    this.invalidateListeners.clear();

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    this.pendingChangedPaths.clear();
    this.pendingProject = undefined;
    this.metrics = {
      triggerCalls: 0,
      broadcastsSent: 0,
      lastTriggerTime: 0,
    };
  }
}

/** Render reload notifier. */
export const ReloadNotifier = new ReloadNotifierImpl();

function normalizeProjectInfo(project?: ReloadProjectInput): ReloadProjectInfo | undefined {
  if (!project) return undefined;
  if (typeof project === "string") return { projectSlug: project };
  return project;
}

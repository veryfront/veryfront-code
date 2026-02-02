import { serverLogger as logger } from "#veryfront/utils";

export interface ReloadProjectInfo {
  projectSlug?: string;
  projectId?: string;
  projectDir?: string;
  environment?: "preview" | "production";
  branch?: string | null;
  releaseId?: string | null;
}

type ReloadListener = (changedPaths?: string[], project?: ReloadProjectInfo) => void;
type InvalidateListener = () => void;
type ReloadProjectInput = ReloadProjectInfo | string | undefined;

const DEBOUNCE_MS = 300;

class ReloadNotifierImpl {
  private listeners = new Set<ReloadListener>();
  private invalidateListeners = new Set<InvalidateListener>();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingChangedPaths = new Set<string>();
  private pendingProject?: ReloadProjectInfo;
  private metrics = {
    triggerCalls: 0,
    broadcastsSent: 0,
    lastTriggerTime: 0,
  };

  subscribe(listener: ReloadListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  subscribeInvalidate(listener: InvalidateListener): () => void {
    this.invalidateListeners.add(listener);
    return () => this.invalidateListeners.delete(listener);
  }

  triggerReload(changedPaths?: string[], project?: ReloadProjectInput): void {
    this.metrics.triggerCalls++;
    this.metrics.lastTriggerTime = Date.now();

    const projectInfo = normalizeProjectInfo(project);

    logger.info("[ReloadNotifier] triggerReload called", {
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

      logger.debug("[ReloadNotifier] Debounce complete, notifying reload listeners", {
        listenerCount: this.listeners.size,
        changedPaths: paths,
        project: pendingProject,
      });

      this.notifyListeners(paths, pendingProject);
    }, DEBOUNCE_MS);
  }

  private notifyInvalidateListeners(): void {
    logger.debug("[ReloadNotifier] Notifying invalidate listeners", {
      count: this.invalidateListeners.size,
    });

    for (const listener of this.invalidateListeners) {
      try {
        listener();
      } catch (error) {
        logger.error("[ReloadNotifier] Invalidate listener error:", error);
      }
    }
  }

  private notifyListeners(changedPaths?: string[], project?: ReloadProjectInfo): void {
    this.metrics.broadcastsSent++;

    logger.debug("[ReloadNotifier] Notifying reload listeners", {
      count: this.listeners.size,
      changedPaths,
      project,
    });

    for (const listener of this.listeners) {
      try {
        listener(changedPaths, project);
      } catch (error) {
        logger.error("[ReloadNotifier] Listener error:", error);
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

export const ReloadNotifier = new ReloadNotifierImpl();

function normalizeProjectInfo(project?: ReloadProjectInput): ReloadProjectInfo | undefined {
  if (!project) return undefined;
  if (typeof project === "string") return { projectSlug: project };
  return project;
}

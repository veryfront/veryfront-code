import { serverLogger } from "#veryfront/utils";

const logger = serverLogger.component("reload-notifier");

export interface ReloadProjectInfo {
  projectSlug?: string;
  projectId?: string;
  projectDir?: string;
  environment?: "preview" | "production";
  branch?: string | null;
  releaseId?: string | null;
  contentSourceId?: string;
  styleArtifactHash?: string;
  styleAssetPath?: string;
}

type ReloadListener = (changedPaths?: string[], project?: ReloadProjectInfo) => void;
type InvalidateListener = () => void;
type ReloadProjectInput = ReloadProjectInfo | string | undefined;

const DEBOUNCE_MS = 300;

interface PendingReload {
  timer?: ReturnType<typeof setTimeout>;
  readonly changedPaths: Set<string>;
  project?: ReloadProjectInfo;
}

class ReloadNotifierImpl {
  private listeners = new Set<ReloadListener>();
  private invalidateListeners = new Set<InvalidateListener>();
  private pendingReloads = new Map<string, PendingReload>();
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

    logger.info("triggerReload called", {
      invalidateListeners: this.invalidateListeners.size,
      reloadListeners: this.listeners.size,
      changedPaths,
      project: projectInfo,
    });

    this.notifyInvalidateListeners();

    const projectKey = getReloadProjectKey(projectInfo);
    const existing = this.pendingReloads.get(projectKey);
    if (existing?.timer !== undefined) clearTimeout(existing.timer);

    const pending: PendingReload = existing ?? {
      changedPaths: new Set<string>(),
    };
    for (const path of changedPaths ?? []) pending.changedPaths.add(path);
    if (projectInfo) pending.project = { ...pending.project, ...projectInfo };

    pending.timer = setTimeout(() => {
      // A newer event for this identity may have replaced this timer. Only the
      // currently registered bucket is allowed to publish and delete itself.
      if (this.pendingReloads.get(projectKey) !== pending) return;
      this.pendingReloads.delete(projectKey);

      const paths = pending.changedPaths.size > 0
        ? Array.from(pending.changedPaths)
        : undefined;
      const pendingProject = pending.project;

      logger.debug("Debounce complete, notifying reload listeners", {
        listenerCount: this.listeners.size,
        changedPaths: paths,
        project: pendingProject,
      });

      this.notifyListeners(paths, pendingProject);
    }, DEBOUNCE_MS);
    this.pendingReloads.set(projectKey, pending);
  }

  private notifyInvalidateListeners(): void {
    logger.debug("Notifying invalidate listeners", {
      count: this.invalidateListeners.size,
    });

    for (const listener of this.invalidateListeners) {
      try {
        listener();
      } catch (error) {
        logger.error("Invalidate listener error:", error);
      }
    }
  }

  private notifyListeners(changedPaths?: string[], project?: ReloadProjectInfo): void {
    this.metrics.broadcastsSent++;

    logger.debug("Notifying reload listeners", {
      count: this.listeners.size,
      changedPaths,
      project,
    });

    for (const listener of this.listeners) {
      try {
        listener(
          changedPaths ? [...changedPaths] : undefined,
          project ? { ...project } : undefined,
        );
      } catch (error) {
        logger.error("Listener error:", error);
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

    for (const pending of this.pendingReloads.values()) {
      if (pending.timer !== undefined) clearTimeout(pending.timer);
    }
    this.pendingReloads.clear();
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
  return { ...project };
}

function getReloadProjectKey(project: ReloadProjectInfo | undefined): string {
  if (!project) return JSON.stringify(["unscoped"]);

  const projectIdentity = project.projectId?.trim()
    ? ["project-id", project.projectId.trim()]
    : project.projectSlug?.trim()
    ? ["project-slug", project.projectSlug.trim()]
    : project.projectDir?.trim()
    ? ["project-dir", project.projectDir.trim()]
    : ["unscoped"];

  const sourceIdentity = project.contentSourceId?.trim()
    ? ["content-source", project.contentSourceId.trim()]
    : project.releaseId?.trim()
    ? ["release", project.releaseId.trim()]
    : project.branch?.trim()
    ? ["branch", project.branch.trim()]
    : ["source", "default"];

  // JSON tuple framing avoids delimiter collisions in user-controlled slugs,
  // branch names, release IDs, and filesystem paths.
  return JSON.stringify([
    projectIdentity,
    ["environment", project.environment ?? "unspecified"],
    sourceIdentity,
  ]);
}

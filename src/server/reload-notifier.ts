import { serverLogger as logger } from "#veryfront/utils";

type ReloadListener = (changedPaths?: string[], projectSlug?: string) => void;
type InvalidateListener = () => void;

const DEBOUNCE_MS = 300;

class ReloadNotifierImpl {
  private listeners = new Set<ReloadListener>();
  private invalidateListeners = new Set<InvalidateListener>();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingChangedPaths = new Set<string>();
  private pendingProjectSlug: string | undefined;
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

  triggerReload(changedPaths?: string[], projectSlug?: string): void {
    this.metrics.triggerCalls++;
    this.metrics.lastTriggerTime = Date.now();

    logger.debug("[ReloadNotifier] triggerReload called", {
      invalidateListeners: this.invalidateListeners.size,
      reloadListeners: this.listeners.size,
      changedPaths: changedPaths?.length ?? 0,
      projectSlug,
    });

    if (changedPaths?.length) {
      for (const path of changedPaths) this.pendingChangedPaths.add(path);
    }

    if (projectSlug) this.pendingProjectSlug = projectSlug;

    this.notifyInvalidateListeners();

    if (this.debounceTimer) clearTimeout(this.debounceTimer);

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;

      const paths = this.pendingChangedPaths.size > 0
        ? Array.from(this.pendingChangedPaths)
        : undefined;
      const slug = this.pendingProjectSlug;

      this.pendingChangedPaths.clear();
      this.pendingProjectSlug = undefined;

      logger.debug(
        "[ReloadNotifier] Debounce complete, notifying reload listeners",
        {
          listenerCount: this.listeners.size,
          changedPaths: paths?.length ?? 0,
          projectSlug: slug,
        },
      );

      this.notifyListeners(paths, slug);
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

  private notifyListeners(changedPaths?: string[], projectSlug?: string): void {
    this.metrics.broadcastsSent++;

    logger.debug("[ReloadNotifier] Notifying reload listeners", {
      count: this.listeners.size,
      changedPaths: changedPaths?.length ?? 0,
      projectSlug,
    });

    for (const listener of this.listeners) {
      try {
        listener(changedPaths, projectSlug);
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
    this.pendingProjectSlug = undefined;
    this.metrics = {
      triggerCalls: 0,
      broadcastsSent: 0,
      lastTriggerTime: 0,
    };
  }
}

export const ReloadNotifier = new ReloadNotifierImpl();

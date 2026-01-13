/**
 * ReloadNotifier - Singleton for triggering browser reloads and cache invalidation
 *
 * Used by VeryfrontFSAdapter to notify browsers when cache is invalidated.
 * DevServer/HMRServer subscribes to broadcast reload messages.
 *
 * Two event types:
 * - invalidate: Triggered immediately when files change (for clearing caches)
 * - reload: Debounced for browser refresh (to batch rapid changes)
 *
 * When changedPaths are provided, HMR can do smart updates instead of full reload.
 */

type ReloadListener = (changedPaths?: string[]) => void;
type InvalidateListener = () => void;

const DEBOUNCE_MS = 300;

class ReloadNotifierImpl {
  private listeners = new Set<ReloadListener>();
  private invalidateListeners = new Set<InvalidateListener>();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingChangedPaths: Set<string> = new Set();
  /** Metrics for observability */
  private metrics = {
    triggerCalls: 0,
    broadcastsSent: 0,
    lastTriggerTime: 0,
  };

  /**
   * Subscribe to reload notifications (debounced, for browser refresh)
   * Listener receives changedPaths if available for smart HMR updates
   */
  subscribe(listener: ReloadListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Subscribe to invalidation notifications (immediate, for cache clearing)
   */
  subscribeInvalidate(listener: InvalidateListener): () => void {
    this.invalidateListeners.add(listener);
    return () => this.invalidateListeners.delete(listener);
  }

  /**
   * Trigger a reload notification to all subscribers (debounced)
   * @param changedPaths - Optional array of changed file paths for smart HMR
   */
  triggerReload(changedPaths?: string[]): void {
    const timeSinceLastTrigger = this.metrics.lastTriggerTime > 0
      ? Date.now() - this.metrics.lastTriggerTime
      : null;
    this.metrics.triggerCalls++;
    this.metrics.lastTriggerTime = Date.now();

    console.log("[ReloadNotifier] ✅ triggerReload called", {
      invalidateListeners: this.invalidateListeners.size,
      reloadListeners: this.listeners.size,
      changedPaths: changedPaths?.length ?? 0,
      totalTriggerCalls: this.metrics.triggerCalls,
      timeSinceLastTriggerMs: timeSinceLastTrigger,
    });

    // Accumulate changed paths for batching
    if (changedPaths) {
      for (const path of changedPaths) {
        this.pendingChangedPaths.add(path);
      }
    }

    // First, trigger immediate invalidation for cache clearing
    this.notifyInvalidateListeners();

    // Then, schedule debounced browser reload
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      const paths = this.pendingChangedPaths.size > 0
        ? Array.from(this.pendingChangedPaths)
        : undefined;
      this.pendingChangedPaths.clear();
      console.log("[ReloadNotifier] ✅ Debounce complete, notifying reload listeners", {
        listenerCount: this.listeners.size,
        changedPaths: paths?.length ?? 0,
      });
      this.notifyListeners(paths);
    }, DEBOUNCE_MS);
  }

  private notifyInvalidateListeners(): void {
    console.log("[ReloadNotifier] ✅ Notifying invalidate listeners", {
      count: this.invalidateListeners.size,
    });
    for (const listener of this.invalidateListeners) {
      try {
        listener();
      } catch (error) {
        console.error("[ReloadNotifier] Invalidate listener error:", error);
      }
    }
    console.log("[ReloadNotifier] ✅ Invalidate listeners notified");
  }

  private notifyListeners(changedPaths?: string[]): void {
    this.metrics.broadcastsSent++;
    console.log("[ReloadNotifier] ✅ Notifying reload listeners", {
      count: this.listeners.size,
      changedPaths: changedPaths?.length ?? 0,
      totalBroadcasts: this.metrics.broadcastsSent,
    });
    for (const listener of this.listeners) {
      try {
        listener(changedPaths);
      } catch (error) {
        console.error("[ReloadNotifier] Listener error:", error);
      }
    }
    console.log("[ReloadNotifier] ✅ Reload listeners notified - browser should refresh now");
  }

  /**
   * Get the number of active listeners
   */
  getListenerCount(): number {
    return this.listeners.size;
  }

  /**
   * Get the number of active invalidate listeners
   */
  getInvalidateListenerCount(): number {
    return this.invalidateListeners.size;
  }

  /**
   * Get metrics for observability
   */
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
}

// Singleton instance
export const ReloadNotifier = new ReloadNotifierImpl();

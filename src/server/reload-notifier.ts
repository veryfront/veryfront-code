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

import { serverLogger as logger } from "#veryfront/utils";

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
    this.metrics.triggerCalls++;
    this.metrics.lastTriggerTime = Date.now();

    logger.debug("[ReloadNotifier] triggerReload called", {
      invalidateListeners: this.invalidateListeners.size,
      reloadListeners: this.listeners.size,
      changedPaths: changedPaths?.length ?? 0,
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
      logger.debug("[ReloadNotifier] Debounce complete, notifying reload listeners", {
        listenerCount: this.listeners.size,
        changedPaths: paths?.length ?? 0,
      });
      this.notifyListeners(paths);
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

  private notifyListeners(changedPaths?: string[]): void {
    this.metrics.broadcastsSent++;
    logger.debug("[ReloadNotifier] Notifying reload listeners", {
      count: this.listeners.size,
      changedPaths: changedPaths?.length ?? 0,
    });
    for (const listener of this.listeners) {
      try {
        listener(changedPaths);
      } catch (error) {
        logger.error("[ReloadNotifier] Listener error:", error);
      }
    }
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

  /**
   * Reset the notifier state (for testing only)
   */
  reset(): void {
    this.listeners.clear();
    this.invalidateListeners.clear();
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.pendingChangedPaths.clear();
    this.metrics = {
      triggerCalls: 0,
      broadcastsSent: 0,
      lastTriggerTime: 0,
    };
  }
}

// Singleton instance
export const ReloadNotifier = new ReloadNotifierImpl();

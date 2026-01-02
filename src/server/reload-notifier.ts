/**
 * ReloadNotifier - Singleton for triggering browser reloads and cache invalidation
 *
 * Used by VeryfrontFSAdapter to notify browsers when cache is invalidated.
 * DevServer/HMRServer subscribes to broadcast reload messages.
 *
 * Two event types:
 * - invalidate: Triggered immediately when files change (for clearing caches)
 * - reload: Debounced for browser refresh (to batch rapid changes)
 */

type ReloadListener = () => void;
type InvalidateListener = () => void;

const DEBOUNCE_MS = 300;

class ReloadNotifierImpl {
  private listeners = new Set<ReloadListener>();
  private invalidateListeners = new Set<InvalidateListener>();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Subscribe to reload notifications (debounced, for browser refresh)
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
   */
  triggerReload(): void {
    console.log("[ReloadNotifier] ✅ triggerReload called", {
      invalidateListeners: this.invalidateListeners.size,
      reloadListeners: this.listeners.size,
    });

    // First, trigger immediate invalidation for cache clearing
    this.notifyInvalidateListeners();

    // Then, schedule debounced browser reload
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      console.log("[ReloadNotifier] ✅ Debounce complete, notifying reload listeners", {
        listenerCount: this.listeners.size,
      });
      this.notifyListeners();
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

  private notifyListeners(): void {
    console.log("[ReloadNotifier] ✅ Notifying reload listeners", {
      count: this.listeners.size,
    });
    for (const listener of this.listeners) {
      try {
        listener();
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
}

// Singleton instance
export const ReloadNotifier = new ReloadNotifierImpl();

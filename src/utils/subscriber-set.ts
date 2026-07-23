/** Listener registry returned by {@link createSubscriberSet}. */
export interface SubscriberSet<Args extends unknown[] = []> {
  /** Register a listener; returns its unsubscribe function. */
  subscribe(listener: (...args: Args) => void): () => void;
  /** Invoke every listener; a throwing listener never stops the others. */
  notify(...args: Args): void;
  /** Number of registered listeners. */
  readonly size: number;
  /** Remove all listeners. */
  clear(): void;
}

/**
 * Create a subscriber set — the canonical subscribe/notify observable used
 * across modules. Notification iterates a snapshot, so a listener that
 * unsubscribes (itself or others) mid-notify is safe, and listener errors are
 * isolated (routed to `onListenerError` when provided, otherwise swallowed).
 */
export function createSubscriberSet<Args extends unknown[] = []>(
  onListenerError?: (error: unknown) => void,
): SubscriberSet<Args> {
  const listeners = new Set<(...args: Args) => void>();

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    notify(...args) {
      for (const listener of [...listeners]) {
        try {
          listener(...args);
        } catch (error) {
          try {
            onListenerError?.(error);
          } catch {
            // A throwing error handler must not break notification either.
          }
        }
      }
    },
    get size() {
      return listeners.size;
    },
    clear() {
      listeners.clear();
    },
  };
}

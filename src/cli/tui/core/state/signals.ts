/**
 * Signal-based Reactive State Management
 *
 * Minimal signals implementation inspired by SolidJS/Preact Signals.
 * Provides fine-grained reactivity for TUI state updates.
 */

// ============================================================================
// Types
// ============================================================================

/** Cleanup function returned by effect subscriptions */
export type Cleanup = () => void;

/** Subscriber callback that receives new values */
export type Subscriber<T> = (value: T) => void;

/** Signal interface for reactive values */
export interface Signal<T> {
  /** Get current value */
  get(): T;
  /** Set new value (triggers subscribers if value changed) */
  set(value: T): void;
  /** Subscribe to value changes */
  subscribe(callback: Subscriber<T>): Cleanup;
  /** Get current value (alias for get) */
  readonly value: T;
}

/** Read-only signal (computed values) */
export interface ReadonlySignal<T> {
  /** Get current value */
  get(): T;
  /** Subscribe to value changes */
  subscribe(callback: Subscriber<T>): Cleanup;
  /** Get current value (alias for get) */
  readonly value: T;
}

// ============================================================================
// Internal State
// ============================================================================

/** Currently executing effect (for automatic dependency tracking) */
let currentEffect: (() => void) | null = null;

/** Batch update tracking */
let batchDepth = 0;
const pendingUpdates = new Set<() => void>();

// ============================================================================
// Signal Implementation
// ============================================================================

/**
 * Create a reactive signal
 *
 * @example
 * ```ts
 * const count = createSignal(0);
 * count.get(); // 0
 * count.set(1);
 * count.get(); // 1
 * ```
 */
export function createSignal<T>(initialValue: T): Signal<T> {
  let value = initialValue;
  const subscribers = new Set<Subscriber<T>>();
  const dependentEffects = new Set<() => void>();

  const signal: Signal<T> = {
    get() {
      // Track dependency if inside an effect
      if (currentEffect) {
        dependentEffects.add(currentEffect);
      }
      return value;
    },

    set(newValue: T) {
      // Only update if value actually changed
      if (!Object.is(value, newValue)) {
        value = newValue;

        // Notify subscribers
        if (batchDepth > 0) {
          // Queue updates during batch
          for (const subscriber of subscribers) {
            pendingUpdates.add(() => subscriber(value));
          }
          for (const effect of dependentEffects) {
            pendingUpdates.add(effect);
          }
        } else {
          // Immediate updates
          for (const subscriber of subscribers) {
            subscriber(value);
          }
          for (const effect of dependentEffects) {
            effect();
          }
        }
      }
    },

    subscribe(callback: Subscriber<T>): Cleanup {
      subscribers.add(callback);
      return () => subscribers.delete(callback);
    },

    get value() {
      return signal.get();
    },
  };

  return signal;
}

// ============================================================================
// Computed Signal
// ============================================================================

/**
 * Create a computed signal that derives its value from other signals
 *
 * @example
 * ```ts
 * const count = createSignal(1);
 * const doubled = createComputed(() => count.get() * 2);
 * doubled.get(); // 2
 * count.set(5);
 * doubled.get(); // 10
 * ```
 */
export function createComputed<T>(fn: () => T): ReadonlySignal<T> {
  let value: T;
  let dirty = true;
  const subscribers = new Set<Subscriber<T>>();
  const dependentEffects = new Set<() => void>();

  // Track dependencies and recompute
  const recompute = () => {
    const prevEffect = currentEffect;
    currentEffect = recompute;
    try {
      const newValue = fn();
      if (!Object.is(value, newValue)) {
        value = newValue;
        dirty = false;

        // Notify subscribers
        for (const subscriber of subscribers) {
          if (batchDepth > 0) {
            pendingUpdates.add(() => subscriber(value));
          } else {
            subscriber(value);
          }
        }
        for (const effect of dependentEffects) {
          if (batchDepth > 0) {
            pendingUpdates.add(effect);
          } else {
            effect();
          }
        }
      }
    } finally {
      currentEffect = prevEffect;
    }
  };

  // Initial computation
  recompute();

  const signal: ReadonlySignal<T> = {
    get() {
      if (currentEffect) {
        dependentEffects.add(currentEffect);
      }
      if (dirty) {
        recompute();
      }
      return value;
    },

    subscribe(callback: Subscriber<T>): Cleanup {
      subscribers.add(callback);
      return () => subscribers.delete(callback);
    },

    get value() {
      return signal.get();
    },
  };

  return signal;
}

// ============================================================================
// Effect
// ============================================================================

/**
 * Create an effect that runs when its dependencies change
 *
 * @example
 * ```ts
 * const count = createSignal(0);
 * const cleanup = createEffect(() => {
 *   console.log("Count is:", count.get());
 * });
 * count.set(1); // Logs: "Count is: 1"
 * cleanup(); // Stop the effect
 * ```
 */
export function createEffect(fn: () => void | Cleanup): Cleanup {
  let cleanup: void | Cleanup;

  const effect = () => {
    // Run cleanup from previous execution
    if (typeof cleanup === "function") {
      cleanup();
    }

    const prevEffect = currentEffect;
    currentEffect = effect;
    try {
      cleanup = fn();
    } finally {
      currentEffect = prevEffect;
    }
  };

  // Run immediately
  effect();

  // Return cleanup function
  return () => {
    if (typeof cleanup === "function") {
      cleanup();
    }
  };
}

// ============================================================================
// Batch Updates
// ============================================================================

/**
 * Batch multiple signal updates into a single update cycle
 *
 * @example
 * ```ts
 * const a = createSignal(1);
 * const b = createSignal(2);
 *
 * batch(() => {
 *   a.set(10);
 *   b.set(20);
 * }); // Effects only run once after batch completes
 * ```
 */
export function batch(fn: () => void): void {
  batchDepth++;
  try {
    fn();
  } finally {
    batchDepth--;
    if (batchDepth === 0) {
      // Flush pending updates
      const updates = [...pendingUpdates];
      pendingUpdates.clear();
      for (const update of updates) {
        update();
      }
    }
  }
}

// ============================================================================
// Utility Signals
// ============================================================================

/**
 * Create a signal that automatically updates based on a condition.
 * Dependencies are tracked automatically via the function execution.
 */
export function createMemo<T>(fn: () => T): ReadonlySignal<T> {
  return createComputed(fn);
}

/**
 * Create a signal from an initial value with a reducer
 */
export function createReducer<T, A>(
  reducer: (state: T, action: A) => T,
  initialState: T,
): [ReadonlySignal<T>, (action: A) => void] {
  const state = createSignal(initialState);

  const dispatch = (action: A) => {
    state.set(reducer(state.get(), action));
  };

  return [state, dispatch];
}

/**
 * Create a boolean signal with toggle helper
 */
export function createToggle(initial = false): Signal<boolean> & { toggle: () => void } {
  const signal = createSignal(initial);
  return {
    ...signal,
    toggle: () => signal.set(!signal.get()),
  };
}

/**
 * Create a signal that debounces updates
 */
export function createDebounced<T>(signal: Signal<T>, delay: number): ReadonlySignal<T> {
  const debounced = createSignal(signal.get());
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  signal.subscribe((value) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      debounced.set(value);
    }, delay);
  });

  return debounced;
}

/**
 * Create a signal that throttles updates
 */
export function createThrottled<T>(signal: Signal<T>, delay: number): ReadonlySignal<T> {
  const throttled = createSignal(signal.get());
  let lastUpdate = 0;
  let pending: T | null = null;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  signal.subscribe((value) => {
    const now = Date.now();
    if (now - lastUpdate >= delay) {
      throttled.set(value);
      lastUpdate = now;
    } else {
      pending = value;
      if (!timeoutId) {
        timeoutId = setTimeout(() => {
          if (pending !== null) {
            throttled.set(pending);
            pending = null;
          }
          lastUpdate = Date.now();
          timeoutId = null;
        }, delay - (now - lastUpdate));
      }
    }
  });

  return throttled;
}

// ============================================================================
// Store (Object-based State)
// ============================================================================

type Store<T extends Record<string, unknown>> = {
  [K in keyof T]: Signal<T[K]>;
};

/**
 * Create a store from an object, where each property becomes a signal
 */
export function createStore<T extends Record<string, unknown>>(
  initial: T,
): Store<T> & { getState: () => T; setState: (partial: Partial<T>) => void } {
  const signals = {} as Store<T>;

  for (const key of Object.keys(initial) as (keyof T)[]) {
    signals[key] = createSignal(initial[key]) as Signal<T[typeof key]>;
  }

  return {
    ...signals,
    getState: () => {
      const state = {} as T;
      for (const key of Object.keys(signals) as (keyof T)[]) {
        state[key] = signals[key].get();
      }
      return state;
    },
    setState: (partial: Partial<T>) => {
      batch(() => {
        for (const key of Object.keys(partial) as (keyof T)[]) {
          if (key in signals) {
            signals[key].set(partial[key] as T[typeof key]);
          }
        }
      });
    },
  };
}

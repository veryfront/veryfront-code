import { rendererLogger } from "@veryfront/utils";

export interface StateStore {
  get<T = unknown>(key: string): T | undefined;
  set<T>(key: string, value: T): void;
  subscribe<T>(key: string, callback: (value: T) => void): () => void;
  clear(): void;
}

class StateBridge implements StateStore {
  private state: Map<string, unknown> = new Map();
  private listeners: Map<string, Set<(value: unknown) => void>> = new Map();
  private persistKeys: Set<string> = new Set();

  constructor() {
    this.restoreState();

    if (typeof window !== "undefined") {
      globalThis.addEventListener("beforeunload", () => this.saveState());
    }
  }

  get<T = unknown>(key: string): T | undefined {
    return this.state.get(key) as T | undefined;
  }

  set<T>(key: string, value: T): void {
    this.state.set(key, value);
    this.notifyListeners(key, value);

    if (this.persistKeys.has(key)) {
      this.saveKey(key, value);
    }
  }

  private notifyListeners(key: string, value: unknown): void {
    const callbacks = this.listeners.get(key);
    if (callbacks) {
      callbacks.forEach((callback) => callback(value));
    }
  }

  subscribe<T>(key: string, callback: (value: T) => void): () => void {
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set());
    }

    const typedCallback = callback as unknown as (value: unknown) => void;
    this.listeners.get(key)?.add(typedCallback);

    return () => {
      const callbacks = this.listeners.get(key);
      if (callbacks) {
        callbacks.delete(typedCallback);
      }
    };
  }

  persist(key: string): void {
    this.persistKeys.add(key);
    const value = this.state.get(key);
    if (value !== undefined) {
      this.saveKey(key, value);
    }
  }

  clear(): void {
    this.state.clear();
    this.listeners.clear();
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.removeItem("veryfront-state");
    }
  }

  private saveState(): void {
    if (typeof sessionStorage === "undefined") return;

    const persistedState: Record<string, unknown> = {};
    for (const key of this.persistKeys) {
      const value = this.state.get(key);
      if (value !== undefined) {
        persistedState[key] = value;
      }
    }

    sessionStorage.setItem("veryfront-state", JSON.stringify(persistedState));
  }

  private saveKey(key: string, value: unknown): void {
    if (typeof sessionStorage === "undefined") return;

    const stored = sessionStorage.getItem("veryfront-state");
    const state = stored ? JSON.parse(stored) : {};
    state[key] = value;
    sessionStorage.setItem("veryfront-state", JSON.stringify(state));
  }

  private restoreState(): void {
    if (typeof sessionStorage === "undefined") return;

    const stored = sessionStorage.getItem("veryfront-state");
    if (!stored) return;

    try {
      const state = JSON.parse(stored);
      Object.entries(state).forEach(([key, value]) => {
        this.state.set(key, value);
        this.persistKeys.add(key);
      });
    } catch (error) {
      rendererLogger.error("[StateBridge] Failed to restore state from sessionStorage:", error);
      // Clear corrupted state to prevent future issues
      try {
        sessionStorage.removeItem("veryfront-state");
      } catch (clearError) {
        rendererLogger.error("[StateBridge] Failed to clear corrupted state:", clearError);
      }
    }
  }
}

let bridgeInstance: StateBridge | null = null;

export function getStateBridge(): StateBridge {
  if (!bridgeInstance) {
    bridgeInstance = new StateBridge();
  }
  return bridgeInstance;
}

// Test-only function to reset singleton
// @ts-ignore - This is only used in tests
export function __resetBridgeForTesting(): void {
  bridgeInstance = null;
}

// React hooks types for compatibility
interface ReactHooksCompat {
  useState: <S>(initialState: S | (() => S)) => [S, (value: S) => void];
  useEffect: (effect: () => void | (() => void), deps?: unknown[]) => void;
  useCallback: <T>(callback: T, deps: unknown[]) => T;
}

// Extend globalThis to include React hooks
interface GlobalWithReact {
  React?: ReactHooksCompat;
}

export function useBridgedState<T>(
  key: string,
  initialValue: T,
  options?: { persist?: boolean },
): [T, (value: T) => void] {
  const globalWithReact = globalThis as unknown as GlobalWithReact;
  const reactHooks: ReactHooksCompat = globalWithReact.React || {
    useState: <S>(initialState: S | (() => S)) =>
      [initialState instanceof Function ? initialState() : initialState, () => {}] as [
        S,
        (value: S) => void,
      ],
    useEffect: () => {},
    useCallback: <U>(fn: U) => fn,
  };

  const { useState, useEffect, useCallback } = reactHooks;
  const bridge = getStateBridge();

  const storedValue = bridge.get(key);
  const initialState = storedValue !== undefined ? storedValue : initialValue;

  const [value, setValue] = useState<T>(initialState as T);

  useEffect(() => {
    const unsubscribe = bridge.subscribe(key, setValue);

    if (options?.persist) {
      bridge.persist(key);
    }

    return unsubscribe;
  }, [key, options?.persist]);

  const setBridgedValue = useCallback(
    (newValue: T) => {
      bridge.set(key, newValue);
      setValue(newValue);
    },
    [key],
  );

  return [value, setBridgedValue];
}

export const SharedState = {
  use: useBridgedState,
  get: (key: string) => getStateBridge().get(key),
  set: <T>(key: string, value: T) => getStateBridge().set(key, value),
};

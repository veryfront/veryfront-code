import * as React from "react";
import type { DependencyList, Dispatch, EffectCallback, SetStateAction } from "react";
import { rendererLogger } from "@veryfront/utils";

export interface StateStore {
  get<T = unknown>(key: string): T | undefined;
  set<T>(key: string, value: T): void;
  subscribe<T>(key: string, callback: (value: T) => void): () => void;
  clear(): void;
}

interface ReactHooksSubset {
  useState: <S>(initialState: S | (() => S)) => [S, Dispatch<SetStateAction<S>>];
  useEffect: (effect: EffectCallback, deps?: DependencyList) => void;
  useCallback: <T extends (...args: any[]) => any>(callback: T, deps: DependencyList) => T;
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

    const state = this.readPersistedState() ?? {};
    state[key] = value;
    sessionStorage.setItem("veryfront-state", JSON.stringify(state));
  }

  private restoreState(): void {
    if (typeof sessionStorage === "undefined") return;

    const state = this.readPersistedState();
    if (!state) return;

    Object.entries(state).forEach(([key, value]) => {
      this.state.set(key, value);
      this.persistKeys.add(key);
    });
  }

  private readPersistedState(): Record<string, unknown> | null {
    if (typeof sessionStorage === "undefined") return null;

    const stored = sessionStorage.getItem("veryfront-state");
    if (!stored) return null;

    try {
      const state = JSON.parse(stored);
      if (state && typeof state === "object" && !Array.isArray(state)) {
        return state as Record<string, unknown>;
      }
      throw new Error("Persisted state is not an object");
    } catch (error) {
      rendererLogger.error("[StateBridge] Failed to parse state from sessionStorage:", error);
      try {
        sessionStorage.removeItem("veryfront-state");
      } catch (clearError) {
        rendererLogger.error("[StateBridge] Failed to clear corrupted state:", clearError);
      }
      return null;
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

export function __resetBridgeForTesting(): void {
  bridgeInstance = null;
}

export function useBridgedState<T>(
  key: string,
  initialValue: T,
  options?: { persist?: boolean },
  testReact?: ReactHooksSubset, // Use the new subset type
): [T, (value: T) => void] {
  const { useState, useEffect, useCallback } = testReact || React;
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

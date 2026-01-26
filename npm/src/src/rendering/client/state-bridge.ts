import * as dntShim from "../../../_dnt.shims.js";
import * as React from "react";
import type { DependencyList, Dispatch, EffectCallback, SetStateAction } from "react";
import { rendererLogger } from "../../utils/index.js";

export interface StateStore {
  get<T = unknown>(key: string): T | undefined;
  set<T>(key: string, value: T): void;
  subscribe<T>(key: string, callback: (value: T) => void): () => void;
  clear(): void;
}

interface ReactHooksSubset {
  useState: <S>(initialState: S | (() => S)) => [S, Dispatch<SetStateAction<S>>];
  useEffect: (effect: EffectCallback, deps?: DependencyList) => void;
  // deno-lint-ignore ban-types
  useCallback: <T extends Function>(callback: T, deps: DependencyList) => T;
}

class StateBridge implements StateStore {
  private state = new Map<string, unknown>();
  private listeners = new Map<string, Set<(value: unknown) => void>>();
  private persistKeys = new Set<string>();
  private boundSaveState: (() => void) | null = null;

  constructor() {
    this.restoreState();

    if (typeof dntShim.dntGlobalThis === "undefined") return;

    this.boundSaveState = () => this.saveState();
    (dntShim.dntGlobalThis as unknown as Window).addEventListener("beforeunload", this.boundSaveState);
  }

  destroy(): void {
    if (this.boundSaveState && typeof dntShim.dntGlobalThis !== "undefined") {
      (dntShim.dntGlobalThis as unknown as Window).removeEventListener("beforeunload", this.boundSaveState);
      this.boundSaveState = null;
    }
    this.clear();
  }

  get<T = unknown>(key: string): T | undefined {
    return this.state.get(key) as T | undefined;
  }

  set<T>(key: string, value: T): void {
    this.state.set(key, value);
    this.notifyListeners(key, value);

    if (this.persistKeys.has(key)) this.saveKey(key, value);
  }

  private notifyListeners(key: string, value: unknown): void {
    const callbacks = this.listeners.get(key);
    if (!callbacks) return;

    for (const callback of callbacks) callback(value);
  }

  subscribe<T>(key: string, callback: (value: T) => void): () => void {
    let callbacks = this.listeners.get(key);
    if (!callbacks) {
      callbacks = new Set();
      this.listeners.set(key, callbacks);
    }

    const typedCallback = callback as unknown as (value: unknown) => void;
    callbacks.add(typedCallback);

    return () => {
      this.listeners.get(key)?.delete(typedCallback);
    };
  }

  persist(key: string): void {
    this.persistKeys.add(key);

    const value = this.state.get(key);
    if (value !== undefined) this.saveKey(key, value);
  }

  clear(): void {
    this.state.clear();
    this.listeners.clear();
    sessionStorage?.removeItem("veryfront-state");
  }

  private saveState(): void {
    if (typeof sessionStorage === "undefined") return;

    const persistedState: Record<string, unknown> = {};
    for (const key of this.persistKeys) {
      const value = this.state.get(key);
      if (value !== undefined) persistedState[key] = value;
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

    for (const [key, value] of Object.entries(state)) {
      this.state.set(key, value);
      this.persistKeys.add(key);
    }
  }

  private readPersistedState(): Record<string, unknown> | null {
    if (typeof sessionStorage === "undefined") return null;

    const stored = sessionStorage.getItem("veryfront-state");
    if (!stored) return null;

    try {
      const state: unknown = JSON.parse(stored);
      if (state && typeof state === "object" && !Array.isArray(state)) {
        return state as Record<string, unknown>;
      }
      throw new Error("Persisted state is not an object");
    } catch (error) {
      rendererLogger.error("[Veryfront] Failed to parse state from sessionStorage:", error);
      try {
        sessionStorage.removeItem("veryfront-state");
      } catch (clearError) {
        rendererLogger.error("[Veryfront] Failed to clear corrupted state:", clearError);
      }
      return null;
    }
  }
}

let bridgeInstance: StateBridge | null = null;

export function getStateBridge(): StateBridge {
  bridgeInstance ??= new StateBridge();
  return bridgeInstance;
}

export function __resetBridgeForTesting(): void {
  bridgeInstance?.destroy();
  bridgeInstance = null;
}

export function useBridgedState<T>(
  key: string,
  initialValue: T,
  options?: { persist?: boolean },
  testReact?: ReactHooksSubset,
): [T, (value: T) => void] {
  const reactHooks = testReact ?? React;
  const { useState, useEffect, useCallback } = reactHooks;
  const bridge = getStateBridge();

  const [value, setValue] = useState<T>((bridge.get(key) ?? initialValue) as T);

  useEffect(() => {
    const unsubscribe = bridge.subscribe(key, setValue);

    if (options?.persist) bridge.persist(key);

    return unsubscribe;
  }, [bridge, key, options?.persist]);

  const setBridgedValue = useCallback(
    (newValue: T) => {
      bridge.set(key, newValue);
      setValue(newValue);
    },
    [bridge, key],
  );

  return [value, setBridgedValue];
}

export const SharedState = {
  use: useBridgedState,
  get: (key: string) => getStateBridge().get(key),
  set: <T>(key: string, value: T) => getStateBridge().set(key, value),
};

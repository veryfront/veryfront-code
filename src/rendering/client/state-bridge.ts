import * as React from "react";
import type { DependencyList, Dispatch, EffectCallback, SetStateAction } from "react";
import { rendererLogger } from "#veryfront/utils";
import { INVALID_ARGUMENT } from "#veryfront/errors/error-registry.ts";

const logger = rendererLogger.component("veryfront");

export interface StateStore {
  get<T = unknown>(key: string): T | undefined;
  set<T>(key: string, value: T): void;
  subscribe<T>(key: string, callback: (value: T) => void): () => void;
  clear(): void;
}

interface ReactHooksSubset {
  useState: <S>(initialState: S | (() => S)) => [S, Dispatch<SetStateAction<S>>];
  useEffect: (effect: EffectCallback, deps?: DependencyList) => void;
  useCallback: <T extends (...args: never[]) => unknown>(callback: T, deps: DependencyList) => T;
}

class StateBridge implements StateStore {
  private state = new Map<string, unknown>();
  private listeners = new Map<string, Set<(value: unknown) => void>>();
  private persistKeys = new Set<string>();
  private boundSaveState: (() => void) | null = null;

  constructor() {
    this.restoreState();

    if (typeof window === "undefined") return;

    this.boundSaveState = () => this.saveState();
    globalThis.addEventListener("beforeunload", this.boundSaveState);
  }

  destroy(): void {
    if (this.boundSaveState && typeof window !== "undefined") {
      globalThis.removeEventListener("beforeunload", this.boundSaveState);
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

    for (const callback of [...callbacks]) {
      try {
        callback(value);
      } catch (error) {
        logger.error("State subscriber failed:", error);
      }
    }
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
      const currentCallbacks = this.listeners.get(key);
      if (!currentCallbacks) return;
      currentCallbacks.delete(typedCallback);
      if (currentCallbacks.size === 0) this.listeners.delete(key);
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
    this.persistKeys.clear();

    const storage = this.getSessionStorage();
    if (!storage) return;
    try {
      storage.removeItem("veryfront-state");
    } catch (error) {
      logger.error("Failed to clear persisted state:", error);
    }
  }

  private saveState(): void {
    const storage = this.getSessionStorage();
    if (!storage) return;

    const persistedState = Object.create(null) as Record<string, unknown>;
    for (const key of this.persistKeys) {
      const value = this.state.get(key);
      if (value !== undefined) persistedState[key] = value;
    }

    try {
      storage.setItem("veryfront-state", JSON.stringify(persistedState));
    } catch (error) {
      logger.error("Failed to save persisted state:", error);
    }
  }

  private saveKey(key: string, value: unknown): void {
    const storage = this.getSessionStorage();
    if (!storage) return;

    const state = Object.create(null) as Record<string, unknown>;
    for (
      const [persistedKey, persistedValue] of Object.entries(
        this.readPersistedState(storage) ?? {},
      )
    ) {
      state[persistedKey] = persistedValue;
    }
    state[key] = value;
    try {
      storage.setItem("veryfront-state", JSON.stringify(state));
    } catch (error) {
      logger.error(`Failed to persist state key "${key}":`, error);
    }
  }

  private restoreState(): void {
    const storage = this.getSessionStorage();
    if (!storage) return;

    const state = this.readPersistedState(storage);
    if (!state) return;

    for (const [key, value] of Object.entries(state)) {
      this.state.set(key, value);
      this.persistKeys.add(key);
    }
  }

  private getSessionStorage(): Storage | null {
    try {
      return typeof globalThis.sessionStorage === "undefined" ? null : globalThis.sessionStorage;
    } catch (error) {
      logger.error("Failed to access sessionStorage:", error);
      return null;
    }
  }

  private readPersistedState(storage: Storage): Record<string, unknown> | null {
    let stored: string | null;
    try {
      stored = storage.getItem("veryfront-state");
    } catch (error) {
      logger.error("Failed to read persisted state:", error);
      return null;
    }
    if (!stored) return null;

    try {
      const state: unknown = JSON.parse(stored);
      if (state && typeof state === "object" && !Array.isArray(state)) {
        return state as Record<string, unknown>;
      }
      throw INVALID_ARGUMENT.create({ detail: "Persisted state is not an object" });
    } catch (error) {
      logger.error("Failed to parse state from sessionStorage:", error);
      try {
        storage.removeItem("veryfront-state");
      } catch (clearError) {
        logger.error("Failed to clear corrupted state:", clearError);
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

export function __resetBridgeForTests(): void {
  bridgeInstance?.destroy();
  bridgeInstance = null;
}

export function useBridgedState<T>(
  key: string,
  initialValue: T,
  options?: { persist?: boolean },
  testReact?: ReactHooksSubset,
): [T, (value: T) => void] {
  const { useState, useEffect, useCallback } = testReact ?? React;
  const bridge = getStateBridge();

  const [value, setValue] = useState<T>(() => bridge.get(key) ?? initialValue);

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

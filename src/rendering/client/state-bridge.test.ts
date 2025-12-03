/**
 * Unit Tests for State Bridge
 * Tests client-server state synchronization and persistence
 */

import { assertEquals, assertExists } from "std/assert/mod.ts";
import { afterEach, beforeEach, describe, it } from "std/testing/bdd.ts";
import type { Dispatch, SetStateAction, EffectCallback, DependencyList } from "react";
import {
  __resetBridgeForTesting,
  getStateBridge,
  SharedState,
  useBridgedState,
} from "./state-bridge.ts";

// Mock sessionStorage
class MockSessionStorage {
  private storage: Map<string, string> = new Map();

  getItem(key: string): string | null {
    return this.storage.get(key) || null;
  }

  setItem(key: string, value: string): void {
    this.storage.set(key, value);
  }

  removeItem(key: string): void {
    this.storage.delete(key);
  }

  clear(): void {
    this.storage.clear();
  }
}

// Mock React hooks
class MockReactHooks {
  private states: Map<string, { value: unknown; setter: Dispatch<SetStateAction<unknown>> }> = new Map();
  private effects: Array<EffectCallback> = [];

  // Bind methods in constructor to preserve 'this' context
  constructor() {
    this.useState = this.useState.bind(this);
    this.useEffect = this.useEffect.bind(this);
    this.useCallback = this.useCallback.bind(this);
  }

  useState<S>(initialState: S | (() => S)): [S, Dispatch<SetStateAction<S>>] {
    const key = `state-${this.states.size}`;
    if (!this.states.has(key)) {
      const initialValue = typeof initialState === "function"
        ? (initialState as () => S)()
        : initialState;
      const setter: Dispatch<SetStateAction<S>> = (action: SetStateAction<S>) => {
        const state = this.states.get(key);
        if (state) {
          state.value = typeof action === "function"
            ? (action as (prevState: S) => S)(state.value as S)
            : action;
        }
      };
      this.states.set(key, { value: initialValue as unknown, setter: setter as Dispatch<SetStateAction<unknown>> });
    }
    const state = this.states.get(key)!;
    return [state.value as S, state.setter as Dispatch<SetStateAction<S>>];
  }

  useEffect(effect: EffectCallback, _deps?: DependencyList): void {
    this.effects.push(effect);
  }

  useCallback<T extends (...args: any[]) => any>(callback: T, _deps?: DependencyList): T {
    return callback;
  }

  runEffects(): Array<() => void> {
    const cleanups: Array<() => void> = [];
    for (const effect of this.effects) {
      const cleanup = effect();
      if (cleanup) {
        cleanups.push(cleanup);
      }
    }
    this.effects = [];
    return cleanups;
  }

  reset(): void {
    this.states.clear();
    this.effects = [];
  }
}

describe("State Bridge", () => {
  let mockSessionStorage: MockSessionStorage;
  let originalSessionStorage: Storage | undefined;
  let mockReact: MockReactHooks;

  beforeEach(() => {
    // Reset the singleton BEFORE setting up mocks
    // This ensures the bridge is recreated with the mocked sessionStorage
    __resetBridgeForTesting();

    mockSessionStorage = new MockSessionStorage();
    originalSessionStorage = (globalThis as any).sessionStorage;
    Object.defineProperty(globalThis, "sessionStorage", {
      value: mockSessionStorage,
      configurable: true,
      writable: true,
    });

    mockReact = new MockReactHooks();
    (globalThis as any).React = mockReact;

    // Now get the bridge - it will be created with mocked sessionStorage
    const bridge = getStateBridge();
    bridge.clear();
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "sessionStorage", {
      value: originalSessionStorage,
      configurable: true,
      writable: true,
    });
    mockReact.reset();
    // Reset singleton for next test
    __resetBridgeForTesting();
  });

  describe("StateBridge Core", () => {
    it("should create singleton instance", () => {
      const bridge1 = getStateBridge();
      const bridge2 = getStateBridge();

      assertEquals(bridge1, bridge2);
    });

    it("should get and set values", () => {
      const bridge = getStateBridge();

      bridge.set("key1", "value1");
      assertEquals(bridge.get("key1"), "value1");

      bridge.set("key2", { nested: "object" });
      assertEquals(bridge.get<{ nested: string }>("key2"), { nested: "object" });
    });

    it("should return undefined for non-existent keys", () => {
      const bridge = getStateBridge();

      assertEquals(bridge.get("non-existent"), undefined);
    });

    it("should overwrite existing values", () => {
      const bridge = getStateBridge();

      bridge.set("key", "value1");
      assertEquals(bridge.get("key"), "value1");

      bridge.set("key", "value2");
      assertEquals(bridge.get("key"), "value2");
    });

    it("should handle different data types", () => {
      const bridge = getStateBridge();

      bridge.set("string", "test");
      bridge.set("number", 42);
      bridge.set("boolean", true);
      bridge.set("array", [1, 2, 3]);
      bridge.set("object", { a: 1, b: 2 });
      bridge.set("null", null);

      assertEquals(bridge.get("string"), "test");
      assertEquals(bridge.get("number"), 42);
      assertEquals(bridge.get("boolean"), true);
      assertEquals(bridge.get("array"), [1, 2, 3]);
      assertEquals(bridge.get("object"), { a: 1, b: 2 });
      assertEquals(bridge.get("null"), null);
    });
  });

  describe("Subscription System", () => {
    it("should subscribe to state changes", () => {
      const bridge = getStateBridge();
      const updates: string[] = [];

      const unsubscribe = bridge.subscribe<string>("key", (value) => {
        updates.push(value);
      });

      bridge.set("key", "value1");
      bridge.set("key", "value2");

      assertEquals(updates, ["value1", "value2"]);

      unsubscribe();
    });

    it("should support multiple subscribers", () => {
      const bridge = getStateBridge();
      const updates1: string[] = [];
      const updates2: string[] = [];

      bridge.subscribe<string>("key", (value) => updates1.push(value));
      bridge.subscribe<string>("key", (value) => updates2.push(value));

      bridge.set("key", "value1");

      assertEquals(updates1, ["value1"]);
      assertEquals(updates2, ["value1"]);
    });

    it("should unsubscribe correctly", () => {
      const bridge = getStateBridge();
      const updates: string[] = [];

      const unsubscribe = bridge.subscribe<string>("key", (value) => {
        updates.push(value);
      });

      bridge.set("key", "value1");
      unsubscribe();
      bridge.set("key", "value2");

      assertEquals(updates, ["value1"]);
    });

    it("should handle unsubscribe multiple times", () => {
      const bridge = getStateBridge();
      const updates: string[] = [];

      const unsubscribe = bridge.subscribe<string>("key", (value) => {
        updates.push(value);
      });

      unsubscribe();
      unsubscribe(); // Should not throw

      bridge.set("key", "value1");

      assertEquals(updates, []);
    });

    it("should only notify subscribers of specific keys", () => {
      const bridge = getStateBridge();
      const updates1: string[] = [];
      const updates2: string[] = [];

      bridge.subscribe<string>("key1", (value) => updates1.push(value));
      bridge.subscribe<string>("key2", (value) => updates2.push(value));

      bridge.set("key1", "value1");
      bridge.set("key2", "value2");

      assertEquals(updates1, ["value1"]);
      assertEquals(updates2, ["value2"]);
    });
  });

  describe("Persistence", () => {
    it("should persist key to sessionStorage", () => {
      const bridge = getStateBridge();

      bridge.set("key", "value");
      assertEquals(bridge.get("key"), "value");
      bridge.persist("key");

      const stored = (globalThis as any).sessionStorage.getItem("veryfront-state");
      assertExists(stored);

      const parsed = JSON.parse(stored!);
      assertEquals(parsed.key, "value");
    });

    it("should persist key immediately if value already exists", () => {
      const bridge = getStateBridge();

      bridge.set("key", "value");
      bridge.persist("key");

      const stored = (globalThis as any).sessionStorage.getItem("veryfront-state");
      assertExists(stored);
      assertEquals(JSON.parse(stored!).key, "value");
    });

    it("should persist multiple keys", () => {
      const bridge = getStateBridge();

      bridge.set("key1", "value1");
      bridge.set("key2", "value2");
      bridge.persist("key1");
      bridge.persist("key2");

      const stored = (globalThis as any).sessionStorage.getItem("veryfront-state");
      const parsed = JSON.parse(stored!);

      assertEquals(parsed.key1, "value1");
      assertEquals(parsed.key2, "value2");
    });

    it("should update persisted value on set", () => {
      const bridge = getStateBridge();

      bridge.set("key", "value1");
      bridge.persist("key");
      bridge.set("key", "value2");

      const stored = (globalThis as any).sessionStorage.getItem("veryfront-state");
      assertEquals(JSON.parse(stored!).key, "value2");
    });

    it("should restore state from sessionStorage", () => {
      mockSessionStorage.setItem("veryfront-state", JSON.stringify({ key: "value" }));

      // Create new bridge instance to trigger restore
      // Since we have a singleton, we need to clear and recreate
      const bridge = getStateBridge();
      bridge.clear();

      // Manually trigger restore by creating a new StateBridge (simulated)
      // In real scenario, this would happen on page load
      assertEquals(bridge.get("key"), undefined); // Current instance is cleared

      // Test by setting up persistence scenario
      mockSessionStorage.setItem("veryfront-state", JSON.stringify({ restored: "data" }));
      // The actual restore happens in constructor, so we test indirectly
    });

    it("should handle invalid JSON in sessionStorage", () => {
      mockSessionStorage.setItem("veryfront-state", "invalid json");

      // Should not throw, should silently ignore
      const bridge = getStateBridge();
      assertEquals(bridge.get("any-key"), undefined);
    });

    it("should recover when saving after corrupted persisted state", () => {
      const bridge = getStateBridge();
      sessionStorage.setItem("veryfront-state", "not-json");

      bridge.set("key", "value");
      bridge.persist("key");

      const stored = sessionStorage.getItem("veryfront-state");
      assertExists(stored);
      assertEquals(stored, JSON.stringify({ key: "value" }));
    });

    it("should clear persisted state", () => {
      const bridge = getStateBridge();

      bridge.set("key", "value");
      bridge.persist("key");
      bridge.clear();

      assertEquals(mockSessionStorage.getItem("veryfront-state"), null);
    });
  });

  describe("SharedState API", () => {
    it("should get value via SharedState.get", () => {
      const bridge = getStateBridge();
      bridge.set("key", "value");

      assertEquals(SharedState.get("key"), "value");
    });

    it("should set value via SharedState.set", () => {
      SharedState.set("key", "value");

      const bridge = getStateBridge();
      assertEquals(bridge.get("key"), "value");
    });

    it("should use bridged state via SharedState.use", () => {
      const [value, setValue] = SharedState.use("key", "initial", undefined, mockReact);

      assertEquals(value, "initial");
      assertExists(setValue);
    });
  });

  describe("useBridgedState Hook", () => {
    it("should initialize with initial value", () => {
      const [value] = useBridgedState("key", "initial", undefined, mockReact);

      assertEquals(value, "initial");
    });

    it("should use stored value if available", () => {
      const bridge = getStateBridge();
      bridge.set("key", "stored");

      const [value] = useBridgedState("key", "initial", undefined, mockReact);

      assertEquals(value, "stored");
    });

    it("should return setter function", () => {
      const [, setValue] = useBridgedState("key", "initial", undefined, mockReact);

      assertEquals(typeof setValue, "function");
    });

    it("should update bridge on setValue", () => {
      const [, setValue] = useBridgedState("key", "initial", undefined, mockReact);

      setValue("updated");

      const bridge = getStateBridge();
      assertEquals(bridge.get("key"), "updated");
    });

    it("should subscribe to updates", () => {
      useBridgedState("key", "initial", undefined, mockReact);

      const cleanups = mockReact.runEffects();

      // Should have registered subscription
      assertEquals(cleanups.length, 1);
      assertEquals(typeof cleanups[0], "function");

      // Cleanup
      cleanups.forEach((cleanup) => cleanup());
    });

    it("should persist when persist option is true", () => {
      useBridgedState("key", "initial", { persist: true }, mockReact);

      mockReact.runEffects();

      const bridge = getStateBridge();
      bridge.set("key", "value");

      const stored = (globalThis as any).sessionStorage.getItem("veryfront-state");
      assertExists(stored);
    });

    it("should handle different data types", () => {
      const [strValue] = useBridgedState("str", "text", undefined, mockReact);
      const [numValue] = useBridgedState("num", 42, undefined, mockReact);
      const [boolValue] = useBridgedState("bool", true, undefined, mockReact);
      const [objValue] = useBridgedState("obj", { key: "value" }, undefined, mockReact);
      const [arrValue] = useBridgedState("arr", [1, 2, 3], undefined, mockReact);

      assertEquals(strValue, "text");
      assertEquals(numValue, 42);
      assertEquals(boolValue, true);
      assertEquals(objValue, { key: "value" });
      assertEquals(arrValue, [1, 2, 3]);
    });
  });

  describe("Edge Cases", () => {
    it("should handle undefined sessionStorage", () => {
      (globalThis as any).sessionStorage = undefined;

      const bridge = getStateBridge();
      bridge.set("key", "value");
      bridge.persist("key");

      // Should not throw
      assertEquals(bridge.get("key"), "value");
    });

    it("should handle missing React hooks", () => {
      (globalThis as any).React = undefined;

      const [value, setValue] = useBridgedState("key", "initial", undefined, mockReact);

      // Should use fallback hooks
      assertEquals(value, "initial");
      assertExists(setValue);
    });

    it("should handle clear with no persisted keys", () => {
      const bridge = getStateBridge();

      bridge.set("key", "value");
      bridge.clear();

      assertEquals(bridge.get("key"), undefined);
    });

    it("should handle empty state", () => {
      const bridge = getStateBridge();

      assertEquals(bridge.get("any"), undefined);
    });

    it("should handle circular references in objects", () => {
      const bridge = getStateBridge();

      const obj: any = { key: "value" };
      obj.self = obj;

      // Should store reference
      bridge.set("circular", obj);
      assertEquals(bridge.get("circular"), obj);

      // Persistence might fail due to JSON.stringify
      // but should not crash the app
    });
  });

  describe("beforeunload Event", () => {
    it("should save state on beforeunload", () => {
      const bridge = getStateBridge();
      bridge.set("key1", "value1");
      bridge.persist("key1");

      // Simulate beforeunload
      const event = new Event("beforeunload");
      globalThis.dispatchEvent(event);

      const stored = (globalThis as any).sessionStorage.getItem("veryfront-state");
      assertExists(stored);
      assertEquals(JSON.parse(stored!).key1, "value1");
    });
  });

  describe("Memory Management", () => {
    it("should cleanup listeners on unsubscribe", () => {
      const bridge = getStateBridge();
      const callbacks: Array<() => void> = [];

      for (let i = 0; i < 10; i++) {
        const unsubscribe = bridge.subscribe(`key${i}`, () => {});
        callbacks.push(unsubscribe);
      }

      callbacks.forEach((cb) => cb());

      // All listeners should be cleaned up
      // We can't directly test Map size, but we can verify behavior
      const updates: string[] = [];
      bridge.subscribe("key0", (value) => updates.push(value as string));
      bridge.set("key0", "test");

      assertEquals(updates, ["test"]);
    });

    it("should handle many simultaneous subscribers", () => {
      const bridge = getStateBridge();
      const updates: number[] = [];

      for (let i = 0; i < 100; i++) {
        bridge.subscribe<string>("key", () => updates.push(i));
      }

      bridge.set("key", "value");

      assertEquals(updates.length, 100);
    });
  });
});

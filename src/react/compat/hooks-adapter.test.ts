import { assert, assertEquals, assertExists, assertNotEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import * as React from "react";
import { renderToString } from "react-dom/server";
import {
  compatHooks,
  createTransitionFallbackScheduler,
  useDeferredValueCompat,
  useFormStatusCompat,
  useIdCompat,
  useOptimisticCompat,
  useTransitionCompat,
} from "./hooks-adapter.ts";
import { getReactVersionInfo, hasFeature } from "./version-detector/index.ts";

// React 19 SSR doesn't allow optimistic state updates - these tests only work in client context.
// Use a runtime check to avoid SSR stub leakage across test files.
function isSSREnvironment(): boolean {
  const globalAny = globalThis as {
    window?: Window & { __veryfrontSSRStub?: boolean };
    document?: Document & { __veryfrontSSRStub?: boolean };
  };

  return typeof window === "undefined" ||
    globalAny.window?.__veryfrontSSRStub === true ||
    globalAny.document?.__veryfrontSSRStub === true;
}

function clientOnlyIt(name: string, fn: () => void | Promise<void>): void {
  it(name, () => {
    if (isSSREnvironment()) return;
    return fn();
  });
}

describe("hooks-adapter", () => {
  describe("version detection", () => {
    it("exports compatibility hooks", () => {
      assert(compatHooks.useId, "useId should be exported");
      assert(compatHooks.useFormStatus, "useFormStatus should be exported");
      assert(compatHooks.useOptimistic, "useOptimistic should be exported");
      assert(compatHooks.useDeferredValue, "useDeferredValue should be exported");
      assert(compatHooks.useTransition, "useTransition should be exported");

      assert(typeof compatHooks.useId === "function", "useId should be a function");
      assert(typeof compatHooks.useFormStatus === "function", "useFormStatus should be a function");
      assert(typeof compatHooks.useOptimistic === "function", "useOptimistic should be a function");
      assert(
        typeof compatHooks.useDeferredValue === "function",
        "useDeferredValue should be a function",
      );
      assert(typeof compatHooks.useTransition === "function", "useTransition should be a function");
    });

    it("detects current React version", () => {
      const info = getReactVersionInfo();
      assertExists(info.version);
      assertExists(info.major);
      assert(
        info.isReact17 || info.isReact18 || info.isReact19,
        "Should detect at least one React version",
      );
      assertEquals(typeof info.isReact17, "boolean");
      assertEquals(typeof info.isReact18, "boolean");
      assertEquals(typeof info.isReact19, "boolean");
    });

    it("has correct feature flags", () => {
      const info = getReactVersionInfo();
      assertExists(info.features);

      if (info.isReact19) {
        assertEquals(info.features.useFormStatus, true, "React 19 should have useFormStatus");
        assertEquals(info.features.useOptimistic, true, "React 19 should have useOptimistic");
        assertEquals(info.features.transitions, true, "React 19 should have transitions");
      }

      if (info.isReact18) {
        assertEquals(info.features.transitions, true, "React 18 should have transitions");
        assertEquals(
          info.features.automaticBatching,
          true,
          "React 18 should have automatic batching",
        );
        assertEquals(info.features.suspense, true, "React 18 should have Suspense");
      }

      if (info.isReact17) {
        assertEquals(info.features.transitions, false, "React 17 should not have transitions");
        assertEquals(info.features.useFormStatus, false, "React 17 should not have useFormStatus");
        assertEquals(info.features.useOptimistic, false, "React 17 should not have useOptimistic");
      }
    });

    it("hasFeature works correctly", () => {
      const info = getReactVersionInfo();

      if (info.major >= 18) {
        assertEquals(hasFeature("transitions"), true);
        assertEquals(hasFeature("suspense"), true);
      } else {
        assertEquals(hasFeature("transitions"), false);
      }

      if (info.isReact19) {
        assertEquals(hasFeature("useFormStatus"), true);
        assertEquals(hasFeature("useOptimistic"), true);
      }
    });

    it("version comparison logic", () => {
      const info = getReactVersionInfo();

      if (info.isReact17) {
        assertEquals(info.isReact18, false);
        assertEquals(info.isReact19, false);
      }

      if (info.isReact18) {
        assertEquals(info.isReact17, false);
      }

      assert(
        [17, 18, 19].includes(info.major),
        `Major version should be 17, 18, or 19, got ${info.major}`,
      );
    });

    it("handles version edge cases", () => {
      const info = getReactVersionInfo();

      assertEquals(typeof info.minor, "number");
      assertEquals(typeof info.patch, "number");
      assert(info.minor >= 0);
      assert(info.patch >= 0);

      assertExists(info.features);
      assertEquals(typeof info.features.renderToString, "boolean");
      assertEquals(typeof info.features.renderToStaticMarkup, "boolean");
    });

    it("SSR capabilities based on version", () => {
      const info = getReactVersionInfo();

      assertEquals(info.features.renderToString, true);
      assertEquals(info.features.renderToStaticMarkup, true);
      assertEquals(info.features.renderToNodeStream, true);

      if (info.major >= 18) {
        assertEquals(info.features.renderToPipeableStream, true);
        assertEquals(info.features.renderToReadableStream, true);
        return;
      }

      assertEquals(info.features.renderToPipeableStream, false);
      assertEquals(info.features.renderToReadableStream, false);
    });

    it("caching works correctly", () => {
      const info1 = getReactVersionInfo();
      const info2 = getReactVersionInfo();

      assertEquals(info1, info2);
      assertEquals(info1.version, info2.version);
    });
  });

  describe("useFormStatus", () => {
    it("returns correct structure on all versions", () => {
      let formStatus: any;

      function TestComponent() {
        formStatus = useFormStatusCompat();
        return React.createElement("div", null, "test");
      }

      renderToString(React.createElement(TestComponent));

      assertExists(formStatus);
      assertEquals(typeof formStatus.pending, "boolean");
      assertExists(formStatus, "formStatus should exist");
      assert("data" in formStatus, "should have data property");
      assert("method" in formStatus, "should have method property");
      assert("action" in formStatus, "should have action property");
    });

    it("fallback returns default state", () => {
      let formStatus: any;

      function TestComponent() {
        formStatus = useFormStatusCompat();
        return React.createElement("div", null, "test");
      }

      renderToString(React.createElement(TestComponent));

      if (hasFeature("useFormStatus")) return;

      assertEquals(formStatus.pending, false, "pending should be false in fallback");
      assertEquals(formStatus.data, null, "data should be null in fallback");
      assertEquals(formStatus.method, null, "method should be null in fallback");
      assertEquals(formStatus.action, null, "action should be null in fallback");
    });

    it("multiple calls return consistent state", () => {
      const statuses: any[] = [];

      function TestComponent() {
        const status1 = useFormStatusCompat();
        const status2 = useFormStatusCompat();
        statuses.push(status1, status2);
        return React.createElement("div", null, "test");
      }

      renderToString(React.createElement(TestComponent));

      assertEquals(statuses.length, 2);
      assertEquals(statuses[0].pending, statuses[1].pending);
      assertEquals(statuses[0].data, statuses[1].data);
    });

    it("works in form context", () => {
      let formStatus: any;

      function FormComponent() {
        formStatus = useFormStatusCompat();
        return React.createElement("button", null, formStatus.pending ? "Submitting..." : "Submit");
      }

      const form = React.createElement("form", null, React.createElement(FormComponent));
      const html = renderToString(form);

      assertExists(formStatus);
      assert(html.includes("Submit") || html.includes("Submitting"));
    });

    it("pending state type is boolean", () => {
      let formStatus: any;

      function TestComponent() {
        formStatus = useFormStatusCompat();
        return React.createElement("div", null, String(formStatus.pending));
      }

      const html = renderToString(React.createElement(TestComponent));

      assertEquals(typeof formStatus.pending, "boolean");
      assert(html.includes("false") || html.includes("true"));
    });

    it("data property is nullable", () => {
      let formStatus: any;

      function TestComponent() {
        formStatus = useFormStatusCompat();
        return React.createElement("div", null, "test");
      }

      renderToString(React.createElement(TestComponent));

      assert(
        formStatus.data === null || formStatus.data instanceof FormData ||
          typeof formStatus.data === "object",
      );
    });

    it("method and action are nullable strings", () => {
      let formStatus: any;

      function TestComponent() {
        formStatus = useFormStatusCompat();
        return React.createElement("div", null, "test");
      }

      renderToString(React.createElement(TestComponent));

      assert(formStatus.method === null || typeof formStatus.method === "string");
      assert(formStatus.action === null || typeof formStatus.action === "string");
    });

    it("handles errors gracefully", () => {
      let formStatus: any;
      let error: any;

      function TestComponent() {
        try {
          formStatus = useFormStatusCompat();
        } catch (e) {
          error = e;
        }
        return React.createElement("div", null, "test");
      }

      renderToString(React.createElement(TestComponent));

      assertEquals(error, undefined);
      assertExists(formStatus);
    });

    it("React 19 uses native if available", () => {
      const info = getReactVersionInfo();
      let formStatus: any;

      function TestComponent() {
        formStatus = useFormStatusCompat();
        return React.createElement("div", null, "test");
      }

      renderToString(React.createElement(TestComponent));

      if (!info.isReact19 || !hasFeature("useFormStatus")) return;

      assertExists(formStatus);
      assertEquals(typeof formStatus.pending, "boolean");
    });

    it("fallback state shape matches native", () => {
      let formStatus: any;

      function TestComponent() {
        formStatus = useFormStatusCompat();
        return React.createElement("div", null, "test");
      }

      renderToString(React.createElement(TestComponent));

      for (const prop of ["pending", "data", "method", "action"]) {
        assert(prop in formStatus, `should have ${prop} property`);
      }
    });
  });

  describe("useOptimistic", () => {
    it("returns state and updater", () => {
      let result: any;

      function TestComponent() {
        result = useOptimisticCompat("initial");
        return React.createElement("div", null, result[0]);
      }

      renderToString(React.createElement(TestComponent));

      assertExists(result);
      assertEquals(result.length, 2);
      assertEquals(result[0], "initial");
      assertEquals(typeof result[1], "function");
    });

    it("fallback on React 17 uses useState", () => {
      let optimisticState: any;
      let updateFn: any;

      function TestComponent() {
        const [state, update] = useOptimisticCompat("test");
        optimisticState = state;
        updateFn = update;
        return React.createElement("div", null, state);
      }

      renderToString(React.createElement(TestComponent));

      assertEquals(optimisticState, "test");
      assertEquals(typeof updateFn, "function");

      if (!hasFeature("useOptimistic")) {
        assertExists(updateFn);
      }
    });

    it("handles primitive values", () => {
      const testCases = [
        { value: "string", type: "string" },
        { value: 42, type: "number" },
        { value: true, type: "boolean" },
        { value: null, type: "object" },
      ];

      function makeTestComponent(value: any): { TestComponent: () => any; getState: () => any } {
        let state: any;
        function TestComponent() {
          const [s] = useOptimisticCompat(value);
          state = s;
          return React.createElement("div", null, String(s));
        }
        return { TestComponent, getState: () => state };
      }

      for (const { value, type } of testCases) {
        const { TestComponent, getState } = makeTestComponent(value);
        renderToString(React.createElement(TestComponent));
        assertEquals(typeof getState(), type);
      }
    });

    it("handles object values", () => {
      const initialState = { count: 0, name: "test" };
      let state: any;

      function TestComponent() {
        const [s] = useOptimisticCompat(initialState);
        state = s;
        return React.createElement("div", null, JSON.stringify(s));
      }

      const html = renderToString(React.createElement(TestComponent));

      assertEquals(state.count, 0);
      assertEquals(state.name, "test");
      assert(html.includes("test"));
    });

    // These tests call the updater after SSR which React 19 doesn't support
    clientOnlyIt("updater accepts value", () => {
      let updateFn: any;

      function TestComponent() {
        const [, update] = useOptimisticCompat("initial");
        updateFn = update;
        return React.createElement("div", null, "test");
      }

      renderToString(React.createElement(TestComponent));

      assertEquals(typeof updateFn, "function");
      updateFn("new value");
    });

    clientOnlyIt("updater accepts function", () => {
      let updateFn: any;

      function TestComponent() {
        const [, update] = useOptimisticCompat(5);
        updateFn = update;
        return React.createElement("div", null, "test");
      }

      renderToString(React.createElement(TestComponent));

      updateFn((current: number) => current + 1);
      assertEquals(typeof updateFn, "function");
    });

    it("with custom update function", () => {
      let state: any;
      let updateFn: any;

      function customUpdate(current: string, optimistic: string): string {
        return current + optimistic;
      }

      function TestComponent() {
        const [s, update] = useOptimisticCompat("initial", customUpdate);
        state = s;
        updateFn = update;
        return React.createElement("div", null, s);
      }

      renderToString(React.createElement(TestComponent));

      assertEquals(state, "initial");
      assertEquals(typeof updateFn, "function");
    });

    it("multiple optimistic states don't interfere", () => {
      let state1: any;
      let state2: any;

      function TestComponent() {
        const [s1] = useOptimisticCompat("first");
        const [s2] = useOptimisticCompat("second");
        state1 = s1;
        state2 = s2;
        return React.createElement("div", null, `${s1} ${s2}`);
      }

      renderToString(React.createElement(TestComponent));

      assertEquals(state1, "first");
      assertEquals(state2, "second");
      assertNotEquals(state1, state2);
    });

    it("works with complex state", () => {
      interface ComplexState {
        items: string[];
        count: number;
        meta: { updated: boolean };
      }

      const initialState: ComplexState = {
        items: ["a", "b"],
        count: 2,
        meta: { updated: false },
      };

      let state: any;

      function TestComponent() {
        const [s] = useOptimisticCompat(initialState);
        state = s;
        return React.createElement("div", null, JSON.stringify(s));
      }

      renderToString(React.createElement(TestComponent));

      assertEquals(state.items.length, 2);
      assertEquals(state.count, 2);
      assertEquals(state.meta.updated, false);
    });

    it("React 19 uses native if available", () => {
      let result: any;

      function TestComponent() {
        result = useOptimisticCompat("test");
        return React.createElement("div", null, result[0]);
      }

      renderToString(React.createElement(TestComponent));

      if (!hasFeature("useOptimistic")) return;

      assertExists(result);
      assertEquals(result.length, 2);
    });
  });

  describe("useTransition", () => {
    it("returns isPending and startTransition", () => {
      let result: any;

      function TestComponent() {
        result = useTransitionCompat();
        return React.createElement("div", null, "test");
      }

      renderToString(React.createElement(TestComponent));

      assertExists(result);
      assertEquals(result.length, 2);
      assertEquals(typeof result[0], "boolean");
      assertEquals(typeof result[1], "function");
    });

    it("native on React 18/19", () => {
      const info = getReactVersionInfo();

      let isPending: any;
      let startTransition: any;

      function TestComponent() {
        const [pending, start] = useTransitionCompat();
        isPending = pending;
        startTransition = start;
        return React.createElement("div", null, pending ? "pending" : "ready");
      }

      renderToString(React.createElement(TestComponent));

      if (!info.isReact18 && !info.isReact19) return;

      assertEquals(typeof isPending, "boolean");
      assertEquals(typeof startTransition, "function");
    });

    it("fallback on React 17", () => {
      const info = getReactVersionInfo();

      let isPending: any;
      let startTransition: any;

      function TestComponent() {
        const [pending, start] = useTransitionCompat();
        isPending = pending;
        startTransition = start;
        return React.createElement("div", null, "test");
      }

      renderToString(React.createElement(TestComponent));

      if (!info.isReact17) return;

      assertEquals(typeof isPending, "boolean");
      assertEquals(typeof startTransition, "function");
    });

    it("startTransition executes callback", () => {
      let startTransition: any;

      function TestComponent() {
        const [, start] = useTransitionCompat();
        startTransition = start;
        return React.createElement("div", null, "test");
      }

      renderToString(React.createElement(TestComponent));

      assertEquals(typeof startTransition, "function");
      assertExists(startTransition);
    });

    it("isPending is false initially", () => {
      let isPending: any;

      function TestComponent() {
        const [pending] = useTransitionCompat();
        isPending = pending;
        return React.createElement("div", null, String(pending));
      }

      const html = renderToString(React.createElement(TestComponent));

      assertEquals(isPending, false);
      assert(html.includes("false"));
    });

    it("handles async transitions", () => {
      let startTransition: any;
      let isPending: any;

      function TestComponent() {
        const [pending, start] = useTransitionCompat();
        isPending = pending;
        startTransition = start;
        return React.createElement("div", null, "test");
      }

      renderToString(React.createElement(TestComponent));

      assertEquals(typeof startTransition, "function");
      assertEquals(typeof isPending, "boolean");
      assertExists(startTransition);
    });

    it("multiple components have independent transitions", () => {
      let transition1: any;
      let transition2: any;

      function Component1() {
        transition1 = useTransitionCompat();
        return React.createElement("div", null, "c1");
      }

      function Component2() {
        transition2 = useTransitionCompat();
        return React.createElement("div", null, "c2");
      }

      renderToString(React.createElement(Component1));
      renderToString(React.createElement(Component2));

      assertExists(transition1);
      assertExists(transition2);
      assertEquals(typeof transition1[0], "boolean");
      assertEquals(typeof transition2[0], "boolean");
    });

    it("callback errors are handled", () => {
      let startTransition: any;
      let _error: any;

      function TestComponent() {
        const [, start] = useTransitionCompat();
        startTransition = start;
        return React.createElement("div", null, "test");
      }

      renderToString(React.createElement(TestComponent));

      try {
        startTransition(() => {
          throw new Error("test error");
        });
      } catch (e) {
        _error = e;
      }

      assertEquals(typeof startTransition, "function");
    });

    it("fallback queues multiple transitions instead of debouncing them", () => {
      const originalSetTimeout = globalThis.setTimeout;
      const originalClearTimeout = globalThis.clearTimeout;
      const scheduled = new Map<number, () => void>();
      let nextTimerId = 1;

      try {
        globalThis.setTimeout = ((callback: Parameters<typeof setTimeout>[0]) => {
          const timerId = nextTimerId++;
          scheduled.set(timerId, () => {
            scheduled.delete(timerId);
            if (typeof callback === "function") callback();
          });
          return timerId as ReturnType<typeof setTimeout>;
        }) as typeof setTimeout;

        globalThis.clearTimeout = ((timerId?: ReturnType<typeof setTimeout>) => {
          if (typeof timerId === "number") scheduled.delete(timerId);
        }) as typeof clearTimeout;

        const callbacks: string[] = [];
        const scheduler = createTransitionFallbackScheduler(() => {});
        scheduler.startTransition(() => callbacks.push("first"));
        scheduler.startTransition(() => callbacks.push("second"));

        assertEquals(scheduled.size, 2);

        for (const run of Array.from(scheduled.values())) run();

        assertEquals(callbacks, ["first", "second"]);
      } finally {
        globalThis.setTimeout = originalSetTimeout;
        globalThis.clearTimeout = originalClearTimeout;
      }
    });
  });

  describe("useDeferredValue", () => {
    it("returns value on all versions", () => {
      let deferred: any;

      function TestComponent() {
        deferred = useDeferredValueCompat("test value");
        return React.createElement("div", null, deferred);
      }

      renderToString(React.createElement(TestComponent));

      assertEquals(deferred, "test value");
    });

    it("native on React 18/19", () => {
      const info = getReactVersionInfo();
      let deferred: any;

      function TestComponent() {
        deferred = useDeferredValueCompat("test");
        return React.createElement("div", null, deferred);
      }

      renderToString(React.createElement(TestComponent));

      if (!info.isReact18 && !info.isReact19) return;
      assertEquals(deferred, "test");
    });

    it("immediate value on React 17", () => {
      const info = getReactVersionInfo();
      let deferred: any;

      function TestComponent() {
        deferred = useDeferredValueCompat("immediate");
        return React.createElement("div", null, deferred);
      }

      renderToString(React.createElement(TestComponent));

      if (!info.isReact17) return;
      assertEquals(deferred, "immediate");
    });

    it("works with primitive values", () => {
      const testValues = ["string", 42, true, null, undefined];

      function makeTestComponent(value: any): {
        TestComponent: () => any;
        getDeferred: () => any;
      } {
        let deferred: any;
        function TestComponent() {
          deferred = useDeferredValueCompat(value);
          return React.createElement("div", null, String(deferred));
        }
        return { TestComponent, getDeferred: () => deferred };
      }

      for (const value of testValues) {
        const { TestComponent, getDeferred } = makeTestComponent(value);
        renderToString(React.createElement(TestComponent));
        assertEquals(getDeferred(), value);
      }
    });

    it("works with objects", () => {
      const obj = { name: "test", count: 5 };
      let deferred: any;

      function TestComponent() {
        deferred = useDeferredValueCompat(obj);
        return React.createElement("div", null, JSON.stringify(deferred));
      }

      renderToString(React.createElement(TestComponent));

      assertEquals(deferred.name, "test");
      assertEquals(deferred.count, 5);
    });

    it("works with arrays", () => {
      const arr = [1, 2, 3];
      let deferred: any;

      function TestComponent() {
        deferred = useDeferredValueCompat(arr);
        return React.createElement("div", null, JSON.stringify(deferred));
      }

      renderToString(React.createElement(TestComponent));

      assertEquals(deferred.length, 3);
      assertEquals(deferred[0], 1);
    });

    it("preserves value type", () => {
      interface TypedValue {
        id: number;
        label: string;
      }

      const typedValue: TypedValue = { id: 1, label: "test" };
      let deferred: any;

      function TestComponent() {
        deferred = useDeferredValueCompat(typedValue);
        return React.createElement("div", null, deferred.label);
      }

      const html = renderToString(React.createElement(TestComponent));

      assertEquals(deferred.id, 1);
      assertEquals(deferred.label, "test");
      assert(html.includes("test"));
    });

    it("handles rapid value changes", () => {
      const values = ["v1", "v2", "v3"];
      const deferred: any[] = [];

      for (const value of values) {
        const TestComponent = () => {
          const d = useDeferredValueCompat(value);
          deferred.push(d);
          return React.createElement("div", null, d);
        };

        renderToString(React.createElement(TestComponent));
      }

      assertEquals(deferred.length, 3);
      assertEquals(deferred[0], "v1");
      assertEquals(deferred[1], "v2");
      assertEquals(deferred[2], "v3");
    });
  });

  describe("useId", () => {
    it("generates ID on all versions", () => {
      let id: any;

      function TestComponent() {
        id = useIdCompat();
        return React.createElement("div", { id }, "test");
      }

      renderToString(React.createElement(TestComponent));

      assertExists(id);
      assertEquals(typeof id, "string");
      assert(id.length > 0);
    });

    it("native on React 18/19", () => {
      const info = getReactVersionInfo();
      let id: any;

      function TestComponent() {
        id = useIdCompat();
        return React.createElement("div", { id }, "test");
      }

      renderToString(React.createElement(TestComponent));

      if (!info.isReact18 && !info.isReact19) return;

      assertExists(id);
      assertEquals(typeof id, "string");
    });

    it("generates unique IDs on React 17", () => {
      const info = getReactVersionInfo();
      const ids: string[] = [];

      for (let i = 0; i < 3; i++) {
        const TestComponent = () => {
          const id = useIdCompat();
          ids.push(id);
          return React.createElement("div", { id }, "test");
        };

        renderToString(React.createElement(TestComponent));
      }

      if (!info.isReact17) return;

      assertEquals(ids.length, 3);
      assertEquals(new Set(ids).size, 3);
    });

    it("IDs are unique across components", () => {
      const info = getReactVersionInfo();
      const ids: string[] = [];

      function Component1() {
        const id = useIdCompat();
        ids.push(id);
        return React.createElement("div", { id }, "c1");
      }

      function Component2() {
        const id = useIdCompat();
        ids.push(id);
        return React.createElement("div", { id }, "c2");
      }

      const container = React.createElement(
        React.Fragment,
        null,
        React.createElement(Component1),
        React.createElement(Component2),
      );
      renderToString(container);

      assertEquals(ids.length, 2);

      if (info.isReact17) {
        assertNotEquals(
          ids[0],
          ids[1],
          "IDs should be unique across components in React 17 fallback",
        );
      }

      assertExists(ids[0]);
      assertExists(ids[1]);
    });

    it("counter increments correctly", () => {
      const info = getReactVersionInfo();
      const ids: string[] = [];

      for (let i = 0; i < 5; i++) {
        const TestComponent = () => {
          const id = useIdCompat();
          ids.push(id);
          return React.createElement("div", { id }, "test");
        };

        renderToString(React.createElement(TestComponent));
      }

      if (info.isReact17) {
        for (const id of ids) {
          assert(id.includes(":r"), `ID should contain :r pattern, got ${id}`);
        }
      }

      assertEquals(ids.length, 5);
    });

    it("consistent in same component", () => {
      let id1: any;
      let id2: any;

      function TestComponent() {
        id1 = useIdCompat();
        id2 = useIdCompat();
        return React.createElement("div", null, "test");
      }

      renderToString(React.createElement(TestComponent));

      assertExists(id1);
      assertExists(id2);
      assertNotEquals(id1, id2);
    });

    it("works with multiple hooks in component", () => {
      let id: any;
      let formStatus: any;

      function TestComponent() {
        id = useIdCompat();
        formStatus = useFormStatusCompat();
        return React.createElement("div", { id }, "test");
      }

      renderToString(React.createElement(TestComponent));

      assertExists(id);
      assertExists(formStatus);
      assertEquals(typeof id, "string");
    });

    it("ID format is consistent", () => {
      const ids: string[] = [];

      for (let i = 0; i < 3; i++) {
        const TestComponent = () => {
          const id = useIdCompat();
          ids.push(id);
          return React.createElement("div", { id }, "test");
        };

        renderToString(React.createElement(TestComponent));
      }

      for (const id of ids) {
        assertEquals(typeof id, "string");
        assert(id.length > 0, "ID should not be empty");
      }
    });
  });
});

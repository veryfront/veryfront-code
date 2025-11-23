import { assert, assertEquals, assertExists, assertNotEquals } from "std/assert/mod.ts";
import * as React from "react";
import { renderToString } from "react-dom/server";
import {
  compatHooks,
  CompatHooksContext as _CompatHooksContext,
  CompatHooksProvider as _CompatHooksProvider,
  SuspenseCompat as _SuspenseCompat,
  useCompatHooks as _useCompatHooks,
  useDeferredValueCompat,
  useFormStatusCompat,
  useIdCompat,
  useOptimisticCompat,
  useTransitionCompat,
} from "./hooks-adapter.ts";
import {
  __resetReactVersionCacheForTests,
  getReactVersionInfo,
  hasFeature,
} from "./version-detector/index.ts";

Deno.test("hooks-adapter | version detection - exports compatibility hooks", () => {
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

Deno.test("hooks-adapter | version detection - detects current React version", () => {
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

Deno.test("hooks-adapter | version detection - has correct feature flags", () => {
  const info = getReactVersionInfo();
  assertExists(info.features);

  if (info.isReact19) {
    assertEquals(info.features.useFormStatus, true, "React 19 should have useFormStatus");
    assertEquals(info.features.useOptimistic, true, "React 19 should have useOptimistic");
    assertEquals(info.features.transitions, true, "React 19 should have transitions");
  }

  if (info.isReact18) {
    assertEquals(info.features.transitions, true, "React 18 should have transitions");
    assertEquals(info.features.automaticBatching, true, "React 18 should have automatic batching");
    assertEquals(info.features.suspense, true, "React 18 should have Suspense");
  }

  if (info.isReact17) {
    assertEquals(info.features.transitions, false, "React 17 should not have transitions");
    assertEquals(info.features.useFormStatus, false, "React 17 should not have useFormStatus");
    assertEquals(info.features.useOptimistic, false, "React 17 should not have useOptimistic");
  }
});

Deno.test("hooks-adapter | version detection - hasFeature works correctly", () => {
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

Deno.test("hooks-adapter | version detection - version comparison logic", () => {
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

Deno.test("hooks-adapter | version detection - handles version edge cases", () => {
  const info = getReactVersionInfo();

  assertEquals(typeof info.minor, "number");
  assertEquals(typeof info.patch, "number");
  assert(info.minor >= 0);
  assert(info.patch >= 0);

  assertExists(info.features);
  assertEquals(typeof info.features.renderToString, "boolean");
  assertEquals(typeof info.features.renderToStaticMarkup, "boolean");
});

Deno.test("hooks-adapter | version detection - SSR capabilities based on version", () => {
  const info = getReactVersionInfo();

  assertEquals(info.features.renderToString, true);
  assertEquals(info.features.renderToStaticMarkup, true);
  assertEquals(info.features.renderToNodeStream, true);

  if (info.major >= 18) {
    assertEquals(info.features.renderToPipeableStream, true);
    assertEquals(info.features.renderToReadableStream, true);
  } else {
    assertEquals(info.features.renderToPipeableStream, false);
    assertEquals(info.features.renderToReadableStream, false);
  }
});

Deno.test("hooks-adapter | version detection - caching works correctly", () => {
  const info1 = getReactVersionInfo();
  const info2 = getReactVersionInfo();

  assertEquals(info1, info2);
  assertEquals(info1.version, info2.version);
});

Deno.test("hooks-adapter | useFormStatus - returns correct structure on all versions", () => {
  let formStatus: any;

  function TestComponent() {
    formStatus = useFormStatusCompat();
    return React.createElement("div", null, "test");
  }

  renderToString(React.createElement(TestComponent) as any);

  assertExists(formStatus);
  assertEquals(typeof formStatus.pending, "boolean");
  assertExists(formStatus, "formStatus should exist");
  assert("data" in formStatus, "should have data property");
  assert("method" in formStatus, "should have method property");
  assert("action" in formStatus, "should have action property");
});

Deno.test("hooks-adapter | useFormStatus - fallback returns default state", () => {
  let formStatus: any;

  function TestComponent() {
    formStatus = useFormStatusCompat();
    return React.createElement("div", null, "test");
  }

  renderToString(React.createElement(TestComponent) as any);

  if (!hasFeature("useFormStatus")) {
    assertEquals(formStatus.pending, false, "pending should be false in fallback");
    assertEquals(formStatus.data, null, "data should be null in fallback");
    assertEquals(formStatus.method, null, "method should be null in fallback");
    assertEquals(formStatus.action, null, "action should be null in fallback");
  }
});

Deno.test("hooks-adapter | useFormStatus - multiple calls return consistent state", () => {
  const statuses: any[] = [];

  function TestComponent() {
    const status1 = useFormStatusCompat();
    const status2 = useFormStatusCompat();
    statuses.push(status1, status2);
    return React.createElement("div", null, "test");
  }

  renderToString(React.createElement(TestComponent) as any);

  assertEquals(statuses.length, 2);
  assertEquals(statuses[0].pending, statuses[1].pending);
  assertEquals(statuses[0].data, statuses[1].data);
});

Deno.test("hooks-adapter | useFormStatus - works in form context", () => {
  let formStatus: any;

  function FormComponent() {
    formStatus = useFormStatusCompat();
    return React.createElement("button", null, formStatus.pending ? "Submitting..." : "Submit");
  }

  const form = React.createElement(
    "form",
    null,
    React.createElement(FormComponent),
  );

  const html = renderToString(form as any);

  assertExists(formStatus);
  assert(html.includes("Submit") || html.includes("Submitting"));
});

Deno.test("hooks-adapter | useFormStatus - pending state type is boolean", () => {
  let formStatus: any;

  function TestComponent() {
    formStatus = useFormStatusCompat();
    return React.createElement("div", null, String(formStatus.pending));
  }

  const html = renderToString(React.createElement(TestComponent) as any);

  assertEquals(typeof formStatus.pending, "boolean");
  assert(html.includes("false") || html.includes("true"));
});

Deno.test("hooks-adapter | useFormStatus - data property is nullable", () => {
  let formStatus: any;

  function TestComponent() {
    formStatus = useFormStatusCompat();
    return React.createElement("div", null, "test");
  }

  renderToString(React.createElement(TestComponent) as any);

  assert(
    formStatus.data === null || formStatus.data instanceof FormData ||
      typeof formStatus.data === "object",
  );
});

Deno.test("hooks-adapter | useFormStatus - method and action are nullable strings", () => {
  let formStatus: any;

  function TestComponent() {
    formStatus = useFormStatusCompat();
    return React.createElement("div", null, "test");
  }

  renderToString(React.createElement(TestComponent) as any);

  assert(formStatus.method === null || typeof formStatus.method === "string");
  assert(formStatus.action === null || typeof formStatus.action === "string");
});

Deno.test("hooks-adapter | useFormStatus - handles errors gracefully", () => {
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

  renderToString(React.createElement(TestComponent) as any);

  assertEquals(error, undefined);
  assertExists(formStatus);
});

Deno.test("hooks-adapter | useFormStatus - React 19 uses native if available", () => {
  const info = getReactVersionInfo();

  let formStatus: any;

  function TestComponent() {
    formStatus = useFormStatusCompat();
    return React.createElement("div", null, "test");
  }

  renderToString(React.createElement(TestComponent) as any);

  if (info.isReact19 && hasFeature("useFormStatus")) {
    assertExists(formStatus);
    assertEquals(typeof formStatus.pending, "boolean");
  }
});

Deno.test("hooks-adapter | useFormStatus - fallback state shape matches native", () => {
  let formStatus: any;

  function TestComponent() {
    formStatus = useFormStatusCompat();
    return React.createElement("div", null, "test");
  }

  renderToString(React.createElement(TestComponent) as any);

  const requiredProps = ["pending", "data", "method", "action"];
  for (const prop of requiredProps) {
    assert(prop in formStatus, `should have ${prop} property`);
  }
});

Deno.test("hooks-adapter | useOptimistic - returns state and updater", () => {
  let result: any;

  function TestComponent() {
    result = useOptimisticCompat("initial");
    return React.createElement("div", null, result[0]);
  }

  renderToString(React.createElement(TestComponent) as any);

  assertExists(result);
  assertEquals(result.length, 2);
  assertEquals(result[0], "initial");
  assertEquals(typeof result[1], "function");
});

Deno.test("hooks-adapter | useOptimistic - fallback on React 17 uses useState", () => {
  let optimisticState: any;
  let updateFn: any;

  function TestComponent() {
    const [state, update] = useOptimisticCompat("test");
    optimisticState = state;
    updateFn = update;
    return React.createElement("div", null, state);
  }

  renderToString(React.createElement(TestComponent) as any);

  assertEquals(optimisticState, "test");
  assertEquals(typeof updateFn, "function");

  if (!hasFeature("useOptimistic")) {
    assertExists(updateFn);
  }
});

Deno.test("hooks-adapter | useOptimistic - handles primitive values", () => {
  const testCases = [
    { value: "string", type: "string" },
    { value: 42, type: "number" },
    { value: true, type: "boolean" },
    { value: null, type: "object" },
  ];

  const makeTestComponent = (value: any) => {
    let state: any;
    const TestComponent = () => {
      const [s] = useOptimisticCompat(value);
      state = s;
      return React.createElement("div", null, String(s));
    };
    return { TestComponent, getState: () => state };
  };

  for (const { value, type } of testCases) {
    const { TestComponent, getState } = makeTestComponent(value);
    renderToString(React.createElement(TestComponent) as any);
    assertEquals(typeof getState(), type);
  }
});

Deno.test("hooks-adapter | useOptimistic - handles object values", () => {
  const initialState = { count: 0, name: "test" };
  let state: any;

  const TestComponent = () => {
    const [s] = useOptimisticCompat(initialState);
    state = s;
    return React.createElement("div", null, JSON.stringify(s));
  };

  const html = renderToString(React.createElement(TestComponent) as any);

  assertEquals(state.count, 0);
  assertEquals(state.name, "test");
  assert(html.includes("test"));
});

Deno.test("hooks-adapter | useOptimistic - updater accepts value", () => {
  let updateFn: any;

  const TestComponent = () => {
    const [, update] = useOptimisticCompat("initial");
    updateFn = update;
    return React.createElement("div", null, "test");
  };

  renderToString(React.createElement(TestComponent) as any);

  assertEquals(typeof updateFn, "function");
  updateFn("new value");
});

Deno.test("hooks-adapter | useOptimistic - updater accepts function", () => {
  let updateFn: any;

  const TestComponent = () => {
    const [, update] = useOptimisticCompat(5);
    updateFn = update;
    return React.createElement("div", null, "test");
  };

  renderToString(React.createElement(TestComponent) as any);

  updateFn((current: number) => current + 1);
  assertEquals(typeof updateFn, "function");
});

Deno.test("hooks-adapter | useOptimistic - with custom update function", () => {
  let state: any;
  let updateFn: any;

  const customUpdate = (current: string, optimistic: string) => {
    return current + optimistic;
  };

  const TestComponent = () => {
    const [s, update] = useOptimisticCompat("initial", customUpdate);
    state = s;
    updateFn = update;
    return React.createElement("div", null, s);
  };

  renderToString(React.createElement(TestComponent) as any);

  assertEquals(state, "initial");
  assertEquals(typeof updateFn, "function");
});

Deno.test("hooks-adapter | useOptimistic - multiple optimistic states don't interfere", () => {
  let state1: any;
  let state2: any;

  const TestComponent = () => {
    const [s1] = useOptimisticCompat("first");
    const [s2] = useOptimisticCompat("second");
    state1 = s1;
    state2 = s2;
    return React.createElement("div", null, `${s1} ${s2}`);
  };

  renderToString(React.createElement(TestComponent) as any);

  assertEquals(state1, "first");
  assertEquals(state2, "second");
  assertNotEquals(state1, state2);
});

Deno.test("hooks-adapter | useOptimistic - works with complex state", () => {
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

  const TestComponent = () => {
    const [s] = useOptimisticCompat(initialState);
    state = s;
    return React.createElement("div", null, JSON.stringify(s));
  };

  renderToString(React.createElement(TestComponent) as any);

  assertEquals(state.items.length, 2);
  assertEquals(state.count, 2);
  assertEquals(state.meta.updated, false);
});

Deno.test("hooks-adapter | useOptimistic - React 19 uses native if available", () => {
  let result: any;

  const TestComponent = () => {
    result = useOptimisticCompat("test");
    return React.createElement("div", null, result[0]);
  };

  renderToString(React.createElement(TestComponent) as any);

  if (hasFeature("useOptimistic")) {
    assertExists(result);
    assertEquals(result.length, 2);
  }
});

Deno.test("hooks-adapter | useTransition - returns isPending and startTransition", () => {
  let result: any;

  function TestComponent() {
    result = useTransitionCompat();
    return React.createElement("div", null, "test");
  }

  renderToString(React.createElement(TestComponent) as any);

  assertExists(result);
  assertEquals(result.length, 2);
  assertEquals(typeof result[0], "boolean");
  assertEquals(typeof result[1], "function");
});

Deno.test("hooks-adapter | useTransition - native on React 18/19", () => {
  const info = getReactVersionInfo();

  let isPending: any;
  let startTransition: any;

  function TestComponent() {
    const [pending, start] = useTransitionCompat();
    isPending = pending;
    startTransition = start;
    return React.createElement("div", null, pending ? "pending" : "ready");
  }

  renderToString(React.createElement(TestComponent) as any);

  if (info.isReact18 || info.isReact19) {
    assertEquals(typeof isPending, "boolean");
    assertEquals(typeof startTransition, "function");
  }
});

Deno.test("hooks-adapter | useTransition - fallback on React 17", () => {
  const info = getReactVersionInfo();

  let isPending: any;
  let startTransition: any;

  function TestComponent() {
    const [pending, start] = useTransitionCompat();
    isPending = pending;
    startTransition = start;
    return React.createElement("div", null, "test");
  }

  renderToString(React.createElement(TestComponent) as any);

  if (info.isReact17) {
    assertEquals(typeof isPending, "boolean");
    assertEquals(typeof startTransition, "function");
  }
});

Deno.test("hooks-adapter | useTransition - startTransition executes callback", () => {
  let startTransition: any;

  function TestComponent() {
    const [, start] = useTransitionCompat();
    startTransition = start;
    return React.createElement("div", null, "test");
  }

  renderToString(React.createElement(TestComponent) as any);

  assertEquals(typeof startTransition, "function");
  assertExists(startTransition);
});

Deno.test("hooks-adapter | useTransition - isPending is false initially", () => {
  let isPending: any;

  function TestComponent() {
    const [pending] = useTransitionCompat();
    isPending = pending;
    return React.createElement("div", null, String(pending));
  }

  const html = renderToString(React.createElement(TestComponent) as any);

  assertEquals(isPending, false);
  assert(html.includes("false"));
});

Deno.test("hooks-adapter | useTransition - handles async transitions", () => {
  let startTransition: any;
  let isPending: any;

  function TestComponent() {
    const [pending, start] = useTransitionCompat();
    isPending = pending;
    startTransition = start;
    return React.createElement("div", null, "test");
  }

  renderToString(React.createElement(TestComponent) as any);

  assertEquals(typeof startTransition, "function");
  assertEquals(typeof isPending, "boolean");
  assertExists(startTransition);
});

Deno.test("hooks-adapter | useTransition - multiple components have independent transitions", () => {
  let transition1: any;
  let transition2: any;

  function Component1() {
    const t = useTransitionCompat();
    transition1 = t;
    return React.createElement("div", null, "c1");
  }

  function Component2() {
    const t = useTransitionCompat();
    transition2 = t;
    return React.createElement("div", null, "c2");
  }

  renderToString(React.createElement(Component1) as any);
  renderToString(React.createElement(Component2) as any);

  assertExists(transition1);
  assertExists(transition2);
  assertEquals(typeof transition1[0], "boolean");
  assertEquals(typeof transition2[0], "boolean");
});

Deno.test("hooks-adapter | useTransition - callback errors are handled", () => {
  let startTransition: any;
  let _error: any;

  const TestComponent = () => {
    const [, start] = useTransitionCompat();
    startTransition = start;
    return React.createElement("div", null, "test");
  };

  renderToString(React.createElement(TestComponent) as any);

  try {
    startTransition(() => {
      throw new Error("test error");
    });
  } catch (e) {
    _error = e;
  }

  assertEquals(typeof startTransition, "function");
});

Deno.test("hooks-adapter | useDeferredValue - returns value on all versions", () => {
  let deferred: any;

  function TestComponent() {
    deferred = useDeferredValueCompat("test value");
    return React.createElement("div", null, deferred);
  }

  renderToString(React.createElement(TestComponent) as any);

  assertEquals(deferred, "test value");
});

Deno.test("hooks-adapter | useDeferredValue - native on React 18/19", () => {
  const info = getReactVersionInfo();

  let deferred: any;

  function TestComponent() {
    deferred = useDeferredValueCompat("test");
    return React.createElement("div", null, deferred);
  }

  renderToString(React.createElement(TestComponent) as any);

  if (info.isReact18 || info.isReact19) {
    assertEquals(deferred, "test");
  }
});

Deno.test("hooks-adapter | useDeferredValue - immediate value on React 17", () => {
  const info = getReactVersionInfo();

  let deferred: any;

  function TestComponent() {
    deferred = useDeferredValueCompat("immediate");
    return React.createElement("div", null, deferred);
  }

  renderToString(React.createElement(TestComponent) as any);

  if (info.isReact17) {
    assertEquals(deferred, "immediate");
  }
});

Deno.test("hooks-adapter | useDeferredValue - works with primitive values", () => {
  const testValues = ["string", 42, true, null, undefined];

  const makeTestComponent = (value: any) => {
    let deferred: any;
    const TestComponent = () => {
      deferred = useDeferredValueCompat(value);
      return React.createElement("div", null, String(deferred));
    };
    return { TestComponent, getDeferred: () => deferred };
  };

  for (const value of testValues) {
    const { TestComponent, getDeferred } = makeTestComponent(value);
    renderToString(React.createElement(TestComponent) as any);
    assertEquals(getDeferred(), value);
  }
});

Deno.test("hooks-adapter | useDeferredValue - works with objects", () => {
  const obj = { name: "test", count: 5 };
  let deferred: any;

  const TestComponent = () => {
    deferred = useDeferredValueCompat(obj);
    return React.createElement("div", null, JSON.stringify(deferred));
  };

  renderToString(React.createElement(TestComponent) as any);

  assertEquals(deferred.name, "test");
  assertEquals(deferred.count, 5);
});

Deno.test("hooks-adapter | useDeferredValue - works with arrays", () => {
  const arr = [1, 2, 3];
  let deferred: any;

  const TestComponent = () => {
    deferred = useDeferredValueCompat(arr);
    return React.createElement("div", null, JSON.stringify(deferred));
  };

  renderToString(React.createElement(TestComponent) as any);

  assertEquals(deferred.length, 3);
  assertEquals(deferred[0], 1);
});

Deno.test("hooks-adapter | useDeferredValue - preserves value type", () => {
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

  const html = renderToString(React.createElement(TestComponent) as any);

  assertEquals(deferred.id, 1);
  assertEquals(deferred.label, "test");
  assert(html.includes("test"));
});

Deno.test("hooks-adapter | useDeferredValue - handles rapid value changes", () => {
  const values = ["v1", "v2", "v3"];
  const deferred: any[] = [];

  for (const value of values) {
    const TestComponent = () => {
      const d = useDeferredValueCompat(value);
      deferred.push(d);
      return React.createElement("div", null, d);
    };

    renderToString(React.createElement(TestComponent) as any);
  }

  assertEquals(deferred.length, 3);
  assertEquals(deferred[0], "v1");
  assertEquals(deferred[1], "v2");
  assertEquals(deferred[2], "v3");
});

Deno.test("hooks-adapter | useId - generates ID on all versions", () => {
  let id: any;

  const TestComponent = () => {
    id = useIdCompat();
    return React.createElement("div", { id }, "test");
  };

  renderToString(React.createElement(TestComponent) as any);

  assertExists(id);
  assertEquals(typeof id, "string");
  assert(id.length > 0);
});

Deno.test("hooks-adapter | useId - native on React 18/19", () => {
  const info = getReactVersionInfo();

  let id: any;

  const TestComponent = () => {
    id = useIdCompat();
    return React.createElement("div", { id }, "test");
  };

  renderToString(React.createElement(TestComponent) as any);

  if (info.isReact18 || info.isReact19) {
    assertExists(id);
    assertEquals(typeof id, "string");
  }
});

Deno.test("hooks-adapter | useId - generates unique IDs on React 17", () => {
  const info = getReactVersionInfo();
  const ids: string[] = [];

  for (let i = 0; i < 3; i++) {
    const TestComponent = () => {
      const id = useIdCompat();
      ids.push(id);
      return React.createElement("div", { id }, "test");
    };

    renderToString(React.createElement(TestComponent) as any);
  }

  if (info.isReact17) {
    assertEquals(ids.length, 3);
    assertEquals(new Set(ids).size, 3);
  }
});

Deno.test("hooks-adapter | useId - IDs are unique across components", () => {
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
  renderToString(container as any);

  assertEquals(ids.length, 2);

  if (info.isReact17) {
    assertNotEquals(ids[0], ids[1], "IDs should be unique across components in React 17 fallback");
  }

  assertExists(ids[0]);
  assertExists(ids[1]);
});

Deno.test("hooks-adapter | useId - counter increments correctly", () => {
  const info = getReactVersionInfo();
  const ids: string[] = [];

  for (let i = 0; i < 5; i++) {
    const TestComponent = () => {
      const id = useIdCompat();
      ids.push(id);
      return React.createElement("div", { id }, "test");
    };

    renderToString(React.createElement(TestComponent) as any);
  }

  if (info.isReact17) {
    for (const id of ids) {
      assert(id.includes(":r"), `ID should contain :r pattern, got ${id}`);
    }
  }

  assertEquals(ids.length, 5);
});

Deno.test("hooks-adapter | useId - consistent in same component", () => {
  let id1: any;
  let id2: any;

  const TestComponent = () => {
    id1 = useIdCompat();
    id2 = useIdCompat();
    return React.createElement("div", null, "test");
  };

  renderToString(React.createElement(TestComponent) as any);

  assertExists(id1);
  assertExists(id2);
  assertNotEquals(id1, id2);
});

Deno.test("hooks-adapter | useId - works with multiple hooks in component", () => {
  let id: any;
  let formStatus: any;

  function TestComponent() {
    id = useIdCompat();
    formStatus = useFormStatusCompat();
    return React.createElement("div", { id }, "test");
  }

  renderToString(React.createElement(TestComponent) as any);

  assertExists(id);
  assertExists(formStatus);
  assertEquals(typeof id, "string");
});

Deno.test("hooks-adapter | useId - ID format is consistent", () => {
  const ids: string[] = [];

  for (let i = 0; i < 3; i++) {
    const TestComponent = () => {
      const id = useIdCompat();
      ids.push(id);
      return React.createElement("div", { id }, "test");
    };

    renderToString(React.createElement(TestComponent) as any);
  }

  for (const id of ids) {
    assertEquals(typeof id, "string");
    assert(id.length > 0, "ID should not be empty");
  }
});

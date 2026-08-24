import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { WorkflowContext } from "./types.ts";
import {
  captureWorkflowContextProjection,
  captureWorkflowProjectionPaths,
  FRAMEWORK_CONTEXT_PROJECTION_KIND,
  getWorkflowContextRootProjection,
  replaceWorkflowContextRootProjection,
  runWithWorkflowContextProjectionTracking,
  type WorkflowContextProjection,
  workflowRuntimeValuesEqual,
} from "./runtime-state.ts";

describe("workflow/runtime-state", () => {
  it("compares the full structured-clone domain without exotic false positives", () => {
    assertEquals(workflowRuntimeValuesEqual(new Date(1), new Date(2)), false);
    assertEquals(
      workflowRuntimeValuesEqual(new Map([["key", 1]]), new Map([["key", 2]])),
      false,
    );
    assertEquals(
      workflowRuntimeValuesEqual(new Set(["one"]), new Set(["two"])),
      false,
    );
    assertEquals(
      workflowRuntimeValuesEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3])),
      false,
    );
    assertEquals(workflowRuntimeValuesEqual(/one/gi, /two/gi), false);

    const left: Record<string, unknown> = { value: new Date(1) };
    const right: Record<string, unknown> = { value: new Date(1) };
    left.self = left;
    right.self = right;
    assertEquals(workflowRuntimeValuesEqual(left, right), true);
  });

  it("retains ownership for nested mutation and clears it for slot replacement", async () => {
    const context: WorkflowContext = {
      input: {},
      nested: { input: { secret: true }, child: { value: "before" } },
    };
    const projection: WorkflowContextProjection = {};
    replaceWorkflowContextRootProjection(projection, "nested", [{
      kind: FRAMEWORK_CONTEXT_PROJECTION_KIND,
      path: [],
    }]);

    await runWithWorkflowContextProjectionTracking(context, projection, (callbackContext) => {
      structuredClone(callbackContext);
      (callbackContext.nested as Record<string, unknown>).downstream = true;
    });
    assertEquals(getWorkflowContextRootProjection(projection, "nested"), [{
      kind: FRAMEWORK_CONTEXT_PROJECTION_KIND,
      path: [],
    }]);

    await runWithWorkflowContextProjectionTracking(context, projection, (callbackContext) => {
      callbackContext.nested = { input: { userOwned: true } };
    });
    assertEquals(getWorkflowContextRootProjection(projection, "nested"), []);
    assertEquals(Object.hasOwn(context, "_workflowProjection"), false);
  });

  it("clears only the replaced descendant in a composite-owned slot", async () => {
    const context: WorkflowContext = {
      input: {},
      mapped: [
        { input: { first: "secret" } },
        { input: { second: "secret" } },
      ],
    };
    const projection: WorkflowContextProjection = {};
    replaceWorkflowContextRootProjection(projection, "mapped", [
      { kind: FRAMEWORK_CONTEXT_PROJECTION_KIND, path: [0] },
      { kind: FRAMEWORK_CONTEXT_PROJECTION_KIND, path: [1] },
    ]);

    await runWithWorkflowContextProjectionTracking(context, projection, (callbackContext) => {
      (callbackContext.mapped as unknown[])[0] = { input: { userOwned: true } };
    });

    assertEquals(getWorkflowContextRootProjection(projection, "mapped"), [
      { kind: FRAMEWORK_CONTEXT_PROJECTION_KIND, path: [1] },
    ]);
  });

  it("clears ownership when a callback installs a deep-equal clone", async () => {
    const context: WorkflowContext = {
      input: {},
      nested: { input: { secret: true }, child: "same" },
    };
    const projection: WorkflowContextProjection = {
      nested: [{ kind: FRAMEWORK_CONTEXT_PROJECTION_KIND, path: [] }],
    };

    await runWithWorkflowContextProjectionTracking(context, projection, (callbackContext) => {
      callbackContext.nested = structuredClone(callbackContext.nested);
    });

    assertEquals(getWorkflowContextRootProjection(projection, "nested"), []);
  });

  it("invalidates a projected root accessor without invoking its getter", async () => {
    const context: WorkflowContext = {
      input: {},
      nested: { input: { secret: true } },
    };
    const projection: WorkflowContextProjection = {
      nested: [{ kind: FRAMEWORK_CONTEXT_PROJECTION_KIND, path: [] }],
    };
    let getterCalls = 0;

    const result = await runWithWorkflowContextProjectionTracking(
      context,
      projection,
      (callbackContext) => {
        Object.defineProperty(callbackContext, "nested", {
          configurable: true,
          enumerable: true,
          get() {
            getterCalls++;
            throw new Error("projected root getter must not execute");
          },
        });
        return "callback succeeded";
      },
    );

    assertEquals(result, "callback succeeded");
    assertEquals(getterCalls, 0);
    assertEquals(getWorkflowContextRootProjection(projection, "nested"), []);
  });

  it("invalidates a nested setter-only accessor even when its read value stays undefined", async () => {
    const context: WorkflowContext = {
      input: {},
      nested: { child: undefined },
    };
    const projection: WorkflowContextProjection = {
      nested: [{ kind: FRAMEWORK_CONTEXT_PROJECTION_KIND, path: ["child"] }],
    };
    let setterCalls = 0;

    const result = await runWithWorkflowContextProjectionTracking(
      context,
      projection,
      (callbackContext) => {
        Object.defineProperty(callbackContext.nested as Record<string, unknown>, "child", {
          configurable: true,
          enumerable: true,
          set(_value: unknown) {
            setterCalls++;
          },
        });
        return "callback succeeded";
      },
    );

    assertEquals(result, "callback succeeded");
    assertEquals(setterCalls, 0);
    assertEquals(getWorkflowContextRootProjection(projection, "nested"), []);
  });

  it("treats a live Proxy path as opaque to projection reconciliation", async () => {
    const child = { secret: true };
    let descriptorHookCalls = 0;
    const handler = Object.create(null);
    Object.defineProperty(handler, "getOwnPropertyDescriptor", {
      configurable: true,
      get() {
        descriptorHookCalls++;
        return Reflect.getOwnPropertyDescriptor;
      },
    });
    const proxy = new Proxy({ child }, handler);
    const context: WorkflowContext = {
      input: {},
      nested: { child },
    };
    const projection: WorkflowContextProjection = {
      nested: [{ kind: FRAMEWORK_CONTEXT_PROJECTION_KIND, path: ["child"] }],
    };
    const callbackResult = { status: "callback succeeded" };

    const result = await runWithWorkflowContextProjectionTracking(
      context,
      projection,
      (callbackContext) => {
        callbackContext.nested = proxy;
        return callbackResult;
      },
    );

    assertStrictEquals(result, callbackResult);
    assertEquals(descriptorHookCalls, 0);
    assertEquals(getWorkflowContextRootProjection(projection, "nested"), []);
  });

  it("invalidates a projected path when descriptor inspection fails", async () => {
    const { proxy, revoke } = Proxy.revocable({ child: { secret: true } }, {});
    const context: WorkflowContext = {
      input: {},
      nested: proxy,
    };
    const projection: WorkflowContextProjection = {
      nested: [{ kind: FRAMEWORK_CONTEXT_PROJECTION_KIND, path: ["child"] }],
    };

    const result = await runWithWorkflowContextProjectionTracking(
      context,
      projection,
      () => {
        revoke();
        return "callback succeeded";
      },
    );

    assertEquals(result, "callback succeeded");
    assertEquals(getWorkflowContextRootProjection(projection, "nested"), []);
  });

  it("preserves ownership for a __proto__ context root without changing prototypes", () => {
    const projection: WorkflowContextProjection = {};
    replaceWorkflowContextRootProjection(projection, "__proto__", [{
      kind: FRAMEWORK_CONTEXT_PROJECTION_KIND,
      path: [],
    }]);

    assertEquals(getWorkflowContextRootProjection(projection, "__proto__"), [{
      kind: FRAMEWORK_CONTEXT_PROJECTION_KIND,
      path: [],
    }]);
    assertEquals(Object.getPrototypeOf(projection), Object.prototype);
  });

  it("does not invoke accessors while capturing projection metadata", () => {
    let getterCalls = 0;
    const path = Object.defineProperty({ path: [] }, "kind", {
      enumerable: true,
      get() {
        getterCalls++;
        return FRAMEWORK_CONTEXT_PROJECTION_KIND;
      },
    });
    const contextProjection = Object.defineProperty({}, "nested", {
      enumerable: true,
      get() {
        getterCalls++;
        return [{ kind: FRAMEWORK_CONTEXT_PROJECTION_KIND, path: [] }];
      },
    });

    assertEquals(captureWorkflowProjectionPaths([path]), []);
    assertEquals(captureWorkflowContextProjection(contextProjection), {});
    assertEquals(getterCalls, 0);
  });

  it("does not invoke projection root accessors while reading", () => {
    let getterCalls = 0;
    const projection = Object.defineProperty({}, "nested", {
      enumerable: true,
      get() {
        getterCalls++;
        return [{ kind: FRAMEWORK_CONTEXT_PROJECTION_KIND, path: [] }];
      },
    }) as WorkflowContextProjection;

    assertEquals(getWorkflowContextRootProjection(projection, "nested"), []);
    assertEquals(getterCalls, 0);
  });
});

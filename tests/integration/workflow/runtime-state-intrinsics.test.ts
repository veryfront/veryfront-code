import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  FRAMEWORK_CONTEXT_PROJECTION_KIND,
  getWorkflowContextRootProjection,
  runWithWorkflowContextProjectionTracking,
  type WorkflowContextProjection,
} from "#veryfront/workflow/runtime-state.ts";
import type { WorkflowContext } from "#veryfront/workflow/types.ts";

function fixture(): {
  context: WorkflowContext;
  projection: WorkflowContextProjection;
} {
  return {
    context: { input: {}, nested: { secret: true } },
    projection: {
      nested: [{ kind: FRAMEWORK_CONTEXT_PROJECTION_KIND, path: [] }],
    },
  };
}

describe("workflow runtime state with hostile ambient intrinsics", () => {
  it("does not trust a replaced Object.is during reconciliation", async () => {
    const { context, projection } = fixture();
    const originalIs = Object.is;
    try {
      await runWithWorkflowContextProjectionTracking(context, projection, (tracked) => {
        tracked.nested = { userOwned: true };
        Object.is = () => true;
      });
    } finally {
      Object.is = originalIs;
    }

    assertEquals(getWorkflowContextRootProjection(projection, "nested"), []);
  });

  it("does not trust a replaced Array.prototype.filter during reconciliation", async () => {
    const { context, projection } = fixture();
    const originalFilter = Array.prototype.filter;
    try {
      await runWithWorkflowContextProjectionTracking(context, projection, (tracked) => {
        tracked.nested = { userOwned: true };
        Array.prototype.filter = function () {
          return this;
        };
      });
    } finally {
      Array.prototype.filter = originalFilter;
    }

    assertEquals(getWorkflowContextRootProjection(projection, "nested"), []);
  });

  it("does not trust live descriptor, Map, or Set methods during reconciliation", async () => {
    const { context, projection } = fixture();
    const originalDescriptor = Object.getOwnPropertyDescriptor;
    const originalMapGet = Map.prototype.get;
    const originalMapSet = Map.prototype.set;
    const originalSetAdd = Set.prototype.add;
    const originalSetHas = Set.prototype.has;
    try {
      await runWithWorkflowContextProjectionTracking(context, projection, (tracked) => {
        tracked.nested = { userOwned: true };
        Object.getOwnPropertyDescriptor = () => {
          throw new Error("poisoned descriptor inspection");
        };
        Map.prototype.get = () => {
          throw new Error("poisoned Map.get");
        };
        Map.prototype.set = () => {
          throw new Error("poisoned Map.set");
        };
        Set.prototype.add = () => {
          throw new Error("poisoned Set.add");
        };
        Set.prototype.has = () => {
          throw new Error("poisoned Set.has");
        };
      });
    } finally {
      Object.getOwnPropertyDescriptor = originalDescriptor;
      Map.prototype.get = originalMapGet;
      Map.prototype.set = originalMapSet;
      Set.prototype.add = originalSetAdd;
      Set.prototype.has = originalSetHas;
    }

    assertEquals(getWorkflowContextRootProjection(projection, "nested"), []);
  });
});

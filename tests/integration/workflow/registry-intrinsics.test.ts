import "#veryfront/schemas/_test-setup.ts";
import { VeryfrontError } from "#veryfront/errors";
import {
  assertEquals,
  assertExists,
  assertInstanceOf,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { workflowRegistry } from "#veryfront/workflow/registry.ts";
import type { WorkflowNode } from "#veryfront/workflow/types.ts";

function stepNode(id: string): WorkflowNode {
  return { id, config: { type: "step", tool: `${id}-tool` } };
}

describe("workflow registry with hostile ambient intrinsics", () => {
  afterEach(() => workflowRegistry.clear());

  it("extracts dynamic metadata after the builder replaces primordials", () => {
    const originalArrayIsArray = Array.isArray;
    const originalGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
    const originalToISOString = Date.prototype.toISOString;
    const originalAgent = Object.getOwnPropertyDescriptor(Object.prototype, "agent");
    const originalDescription = Object.getOwnPropertyDescriptor(
      Object.prototype,
      "description",
    );
    const originalInputSchema = Object.getOwnPropertyDescriptor(
      Object.prototype,
      "inputSchema",
    );
    const originalOutputSchema = Object.getOwnPropertyDescriptor(
      Object.prototype,
      "outputSchema",
    );
    try {
      workflowRegistry.register({
        id: "hostile-dynamic-metadata",
        introspect: true,
        steps: () => {
          const node: WorkflowNode = {
            id: "dynamic-step",
            config: { type: "step", tool: { id: "dynamic-step-tool" } },
          };
          Array.isArray = (() => false) as unknown as typeof Array.isArray;
          Object.getOwnPropertyDescriptor = () => undefined;
          Date.prototype.toISOString = () => "forged-time";
          Object.defineProperty(Object.prototype, "agent", {
            configurable: true,
            value: "forged-agent",
          });
          Object.defineProperty(Object.prototype, "description", {
            configurable: true,
            value: "forged-description",
          });
          Object.defineProperty(Object.prototype, "inputSchema", {
            configurable: true,
            value: {},
          });
          Object.defineProperty(Object.prototype, "outputSchema", {
            configurable: true,
            value: {},
          });
          return [node];
        },
      });
    } finally {
      Array.isArray = originalArrayIsArray;
      Object.getOwnPropertyDescriptor = originalGetOwnPropertyDescriptor;
      Date.prototype.toISOString = originalToISOString;
      if (originalAgent) Object.defineProperty(Object.prototype, "agent", originalAgent);
      else Reflect.deleteProperty(Object.prototype, "agent");
      if (originalDescription) {
        Object.defineProperty(Object.prototype, "description", originalDescription);
      } else Reflect.deleteProperty(Object.prototype, "description");
      if (originalInputSchema) {
        Object.defineProperty(Object.prototype, "inputSchema", originalInputSchema);
      } else Reflect.deleteProperty(Object.prototype, "inputSchema");
      if (originalOutputSchema) {
        Object.defineProperty(Object.prototype, "outputSchema", originalOutputSchema);
      } else Reflect.deleteProperty(Object.prototype, "outputSchema");
    }

    const metadata = workflowRegistry.get("hostile-dynamic-metadata");
    assertExists(metadata);
    assertEquals(metadata.nodeTypes, ["step"]);
    assertEquals(metadata.nodes, [{
      id: "dynamic-step",
      type: "step",
      dependsOn: undefined,
      tool: "dynamic-step-tool",
    }]);
    assertEquals(metadata.agentRefs, []);
    assertEquals(metadata.toolRefs, ["dynamic-step-tool"]);
    assertEquals(metadata.description, undefined);
    assertEquals(metadata.hasInputSchema, false);
    assertEquals(metadata.hasOutputSchema, false);
    assertEquals(metadata.registeredAt === "forged-time", false);
    assertEquals(Number.isNaN(Date.parse(metadata.registeredAt)), false);
  });

  it("requires descriptor value fields to be own properties", () => {
    const originalValue = Object.getOwnPropertyDescriptor(Object.prototype, "value");
    let pollutionGetterCalls = 0;
    let definitionGetterCalls = 0;
    const wrapper = Object.defineProperty({ id: "wrapper" }, "definition", {
      enumerable: true,
      get() {
        definitionGetterCalls++;
        return { id: "accessor-definition", steps: [stepNode("step")] };
      },
    });
    let error: unknown;
    try {
      Object.defineProperty(Object.prototype, "value", {
        configurable: true,
        get() {
          pollutionGetterCalls++;
          return { id: "polluted-definition", steps: [stepNode("step")] };
        },
      });
      error = assertThrows(() => workflowRegistry.register(wrapper as never));
    } finally {
      if (originalValue) Object.defineProperty(Object.prototype, "value", originalValue);
      else Reflect.deleteProperty(Object.prototype, "value");
    }

    assertInstanceOf(error, VeryfrontError);
    assertEquals(pollutionGetterCalls, 0);
    assertEquals(definitionGetterCalls, 0);
    assertEquals(workflowRegistry.has("polluted-definition"), false);
  });

  it("computes arrays and statistics without live Map and Array helpers", () => {
    workflowRegistry.register({ id: "one", steps: [stepNode("first")] });
    workflowRegistry.register({ id: "two", steps: [stepNode("second")] });
    const originalArrayFrom = Array.from;
    const originalMapForEach = Map.prototype.forEach;
    const originalMapValues = Map.prototype.values;
    let all;
    let stats;
    try {
      Array.from = (() => []) as typeof Array.from;
      Map.prototype.forEach = () => {
        throw new Error("ambient Map.prototype.forEach must not be called");
      };
      Map.prototype.values = function () {
        return {
          next: () => ({ value: undefined, done: true }),
          [Symbol.iterator]() {
            return this;
          },
        } as never;
      };
      all = workflowRegistry.getAllAsArray();
      stats = workflowRegistry.getStats();
    } finally {
      Array.from = originalArrayFrom;
      Map.prototype.forEach = originalMapForEach;
      Map.prototype.values = originalMapValues;
    }

    assertEquals(all.map((metadata) => metadata.id), ["one", "two"]);
    assertEquals(stats, {
      total: 2,
      byNodeType: { step: 2 },
      withInputSchema: 0,
      withOutputSchema: 0,
    });
  });
});

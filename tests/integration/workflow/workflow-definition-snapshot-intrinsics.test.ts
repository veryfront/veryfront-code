import "#veryfront/schemas/_test-setup.ts";

import { VeryfrontError } from "#veryfront/errors";
import { assertEquals, assertInstanceOf, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  captureWorkflowDefinition,
  captureWorkflowStaticValue,
} from "#veryfront/workflow/executor/workflow-definition-snapshot.ts";
import type { WorkflowDefinition, WorkflowNode } from "#veryfront/workflow/types.ts";

function stepNode(id: string): WorkflowNode {
  return { id, config: { type: "step", tool: `${id}-tool` } };
}

describe("workflow definition snapshots with hostile ambient intrinsics", () => {
  it("captures structured values without live reflection and brand helpers", () => {
    const input = {
      array: [{ nested: "value" }],
      bytes: new Uint8Array([1, 2]),
      date: new Date("2026-01-02T03:04:05.000Z"),
      map: new Map([["key", { count: 1 }]]),
      regexp: /value/u,
      set: new Set(["entry"]),
    };
    const originalArrayIsArray = Array.isArray;
    const originalDateGetTime = Date.prototype.getTime;
    const originalNumberIsFinite = Number.isFinite;
    const originalNumberIsSafeInteger = Number.isSafeInteger;
    const originalGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
    const originalReflectApply = Reflect.apply;
    const originalReflectOwnKeys = Reflect.ownKeys;
    const OriginalString = String;
    let poisonCalls = 0;
    const poison = (): never => {
      poisonCalls++;
      throw new Error("ambient static-value intrinsic must not run");
    };
    let captured: typeof input | undefined;

    try {
      Array.isArray = poison as unknown as typeof Array.isArray;
      Date.prototype.getTime = poison;
      Number.isFinite = poison;
      Number.isSafeInteger = poison;
      Object.getOwnPropertyDescriptor = poison as typeof Object.getOwnPropertyDescriptor;
      Reflect.apply = poison as typeof Reflect.apply;
      Reflect.ownKeys = poison as typeof Reflect.ownKeys;
      globalThis.String = poison as unknown as StringConstructor;
      captured = captureWorkflowStaticValue(input, "Static input");
    } finally {
      Array.isArray = originalArrayIsArray;
      Date.prototype.getTime = originalDateGetTime;
      Number.isFinite = originalNumberIsFinite;
      Number.isSafeInteger = originalNumberIsSafeInteger;
      Object.getOwnPropertyDescriptor = originalGetOwnPropertyDescriptor;
      Reflect.apply = originalReflectApply;
      Reflect.ownKeys = originalReflectOwnKeys;
      globalThis.String = OriginalString;
    }

    assertEquals(poisonCalls, 0);
    assertEquals(captured, input);
    assertEquals(captured === input, false);
  });

  it("captures nested arrays without live clone, iterator, or WeakSet helpers", () => {
    const input = [{ nested: ["value"] }];
    const originalArrayIterator = Array.prototype[Symbol.iterator];
    const originalStructuredClone = structuredClone;
    const OriginalWeakSet = WeakSet;
    const originalWeakSetAdd = WeakSet.prototype.add;
    const originalWeakSetDelete = WeakSet.prototype.delete;
    const originalWeakSetHas = WeakSet.prototype.has;
    let poisonCalls = 0;
    const poison = (): never => {
      poisonCalls++;
      throw new Error("ambient static-value traversal must not run");
    };
    let captured: typeof input | undefined;

    try {
      Array.prototype[Symbol.iterator] = poison;
      globalThis.structuredClone = poison;
      WeakSet.prototype.add = poison;
      WeakSet.prototype.delete = poison;
      WeakSet.prototype.has = poison;
      globalThis.WeakSet = poison as unknown as WeakSetConstructor;
      captured = captureWorkflowStaticValue(input, "Nested input");
    } finally {
      Array.prototype[Symbol.iterator] = originalArrayIterator;
      globalThis.structuredClone = originalStructuredClone;
      globalThis.WeakSet = OriginalWeakSet;
      WeakSet.prototype.add = originalWeakSetAdd;
      WeakSet.prototype.delete = originalWeakSetDelete;
      WeakSet.prototype.has = originalWeakSetHas;
    }

    assertEquals(poisonCalls, 0);
    assertEquals(captured, input);
    assertEquals(Object.isFrozen(captured), true);
    assertEquals(Object.isFrozen(captured?.[0]), true);
  });

  it("rejects accessors under descriptor prototype pollution without invoking hooks", () => {
    const originalValue = Object.getOwnPropertyDescriptor(Object.prototype, "value");
    let accessorCalls = 0;
    let pollutionCalls = 0;
    const input = Object.defineProperty({}, "secret", {
      enumerable: true,
      get() {
        accessorCalls++;
        return "secret";
      },
    });
    let error: unknown;

    try {
      Object.defineProperty(Object.prototype, "value", {
        configurable: true,
        get() {
          pollutionCalls++;
          return "forged";
        },
      });
      error = assertThrows(() => captureWorkflowStaticValue(input, "Accessor input"));
    } finally {
      if (originalValue) Object.defineProperty(Object.prototype, "value", originalValue);
      else Reflect.deleteProperty(Object.prototype, "value");
    }

    assertInstanceOf(error, VeryfrontError);
    assertEquals(accessorCalls, 0);
    assertEquals(pollutionCalls, 0);
  });

  it("captures workflow graphs without live collection and string helpers", () => {
    const workflow: WorkflowDefinition = {
      id: "hostile-graph",
      steps: [{
        id: "parallel",
        config: {
          type: "parallel",
          strategy: "all",
          nodes: [stepNode("nested")],
        },
      }, {
        id: "loop",
        dependsOn: ["parallel"],
        config: {
          type: "loop",
          while: () => false,
          steps: [],
          maxIterations: 1,
        },
      }],
    };
    const OriginalMap = Map;
    const originalMapGet = Map.prototype.get;
    const originalMapHas = Map.prototype.has;
    const originalMapSet = Map.prototype.set;
    const originalNumberIsSafeInteger = Number.isSafeInteger;
    const originalObjectHasOwn = Object.hasOwn;
    const originalObjectValues = Object.values;
    const OriginalSet = Set;
    const originalSetAdd = Set.prototype.add;
    const originalSetHas = Set.prototype.has;
    const originalArrayFlatMap = Array.prototype.flatMap;
    const originalArrayIncludes = Array.prototype.includes;
    const originalArrayIterator = Array.prototype[Symbol.iterator];
    const originalArrayPush = Array.prototype.push;
    const originalStringEndsWith = String.prototype.endsWith;
    const originalStringTrim = String.prototype.trim;
    let poisonCalls = 0;
    const poison = (): never => {
      poisonCalls++;
      throw new Error("ambient workflow graph intrinsic must not run");
    };
    let captured: WorkflowDefinition | undefined;

    try {
      Map.prototype.get = poison;
      Map.prototype.has = poison;
      Map.prototype.set = poison;
      Number.isSafeInteger = poison;
      Object.hasOwn = poison;
      Object.values = poison;
      Set.prototype.add = poison;
      Set.prototype.has = poison;
      Array.prototype.flatMap = poison;
      Array.prototype.includes = poison;
      Array.prototype[Symbol.iterator] = poison;
      Array.prototype.push = poison;
      String.prototype.endsWith = poison;
      String.prototype.trim = poison;
      globalThis.Map = poison as unknown as MapConstructor;
      globalThis.Set = poison as unknown as SetConstructor;
      captured = captureWorkflowDefinition(workflow);
    } finally {
      globalThis.Map = OriginalMap;
      Map.prototype.get = originalMapGet;
      Map.prototype.has = originalMapHas;
      Map.prototype.set = originalMapSet;
      Number.isSafeInteger = originalNumberIsSafeInteger;
      Object.hasOwn = originalObjectHasOwn;
      Object.values = originalObjectValues;
      globalThis.Set = OriginalSet;
      Set.prototype.add = originalSetAdd;
      Set.prototype.has = originalSetHas;
      Array.prototype.flatMap = originalArrayFlatMap;
      Array.prototype.includes = originalArrayIncludes;
      Array.prototype[Symbol.iterator] = originalArrayIterator;
      Array.prototype.push = originalArrayPush;
      String.prototype.endsWith = originalStringEndsWith;
      String.prototype.trim = originalStringTrim;
    }

    assertEquals(poisonCalls, 0);
    assertEquals(captured?.id, "hostile-graph");
    assertEquals((captured?.steps as WorkflowNode[]).map((node) => node.id), [
      "parallel",
      "loop",
    ]);
  });
});

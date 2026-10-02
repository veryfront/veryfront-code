/**
 * Warning-phase schema handling after task code changed shared built-ins
 * (veryfront/veryfront-issue-inbox#2108). These cases replace intrinsics and prototypes of the
 * shared realm on purpose, so they live here rather than in hermetic unit tests.
 */
import "#veryfront/schemas/_test-setup.ts";
import { createInMemoryHostRuntime } from "#veryfront/platform/compat/process.ts";
import { defineSchema } from "#veryfront/schemas/define.ts";
import { canonicalJsonSchema, schemaIdentitySha256 } from "#veryfront/schemas/schema-identity.ts";
import {
  escapePointerSegment,
  formatSchemaValidationErrors,
} from "#veryfront/schemas/validation-errors.ts";
import { assertEquals, assertMatch } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { type RunnableTask, runTask } from "#veryfront/task/runner.ts";
import type { TaskContext, TaskDefinition } from "#veryfront/task/types.ts";

function makeTask(definition: TaskDefinition): RunnableTask {
  return { id: "classify", name: "classify", definition };
}

const VECTOR_SCHEMA = {
  type: "object",
  required: ["ticketText"],
  properties: { ticketText: { minLength: 1, type: "string" } },
  additionalProperties: false,
};
const VECTOR_CANONICAL =
  '{"additionalProperties":false,"properties":{"ticketText":{"minLength":1,"type":"string"}},"required":["ticketText"],"type":"object"}';

const ticketInputSchema = {
  type: "object",
  properties: { ticketText: { type: "string", minLength: 1 } },
  required: ["ticketText"],
  additionalProperties: false,
};
const ticketOutputSchema = {
  type: "object",
  properties: {
    category: { type: "string", enum: ["billing", "technical", "account", "other"] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
  required: ["category", "confidence"],
  additionalProperties: false,
};

function schemaTask(
  schemas: Pick<TaskDefinition, "inputSchema" | "outputSchema">,
  output: unknown = { category: "billing", confidence: 0.94 },
): { task: RunnableTask; calls: Array<Partial<TaskContext>> } {
  const calls: Array<Partial<TaskContext>> = [];
  const task = makeTask({
    ...schemas,
    run: (ctx) => {
      calls.push({ input: ctx.input, config: ctx.config });
      return output;
    },
  });
  return { task, calls };
}

describe("schema identity after project code replaced built-ins", () => {
  it("canonicalizes with the intrinsics captured before project code runs", () => {
    const hostObject = Object;
    const hostArray = Array;
    const hostJson = JSON;
    const keys = hostObject.keys;
    const isArray = hostArray.isArray;
    const stringify = hostJson.stringify;
    try {
      hostObject.keys = () => {
        throw new Error("replaced Object.keys");
      };
      hostArray.isArray = (() => false) as unknown as typeof Array.isArray;
      hostJson.stringify = (() => "forged") as typeof JSON.stringify;

      const canonical = canonicalJsonSchema(VECTOR_SCHEMA);

      hostJson.stringify = stringify;
      assertEquals(canonical, VECTOR_CANONICAL);
    } finally {
      hostObject.keys = keys;
      hostArray.isArray = isArray;
      hostJson.stringify = stringify;
    }
  });

  it("canonicalizes without inherited toJSON hooks", () => {
    const originalObjectToJson = Reflect.getOwnPropertyDescriptor(Object.prototype, "toJSON");
    const originalArrayToJson = Reflect.getOwnPropertyDescriptor(Array.prototype, "toJSON");
    let canonical: string | undefined;
    try {
      Reflect.set(Object.prototype, "toJSON", () => "forged");
      Reflect.set(Array.prototype, "toJSON", () => {
        throw new Error("replaced Array.prototype.toJSON");
      });
      canonical = canonicalJsonSchema(VECTOR_SCHEMA);
    } finally {
      Reflect.deleteProperty(Object.prototype, "toJSON");
      Reflect.deleteProperty(Array.prototype, "toJSON");
      if (originalObjectToJson) {
        Reflect.defineProperty(Object.prototype, "toJSON", originalObjectToJson);
      }
      if (originalArrayToJson) {
        Reflect.defineProperty(Array.prototype, "toJSON", originalArrayToJson);
      }
    }

    assertEquals(canonical, VECTOR_CANONICAL);
  });
  it("hashes a contract schema when project code replaced Array.isArray", async () => {
    const contract = defineSchema((v) => v.object({ ticketText: v.string() }))();
    const baseline = await schemaIdentitySha256(contract);
    const originalIsArray = Reflect.getOwnPropertyDescriptor(Array, "isArray")!;
    let identity: string | null = null;
    try {
      Reflect.set(Array, "isArray", () => true);
      identity = await schemaIdentitySha256(contract);
    } finally {
      Reflect.defineProperty(Array, "isArray", originalIsArray);
    }

    assertMatch(baseline ?? "", /^[0-9a-f]{64}$/);
    assertEquals(identity, baseline);
  });
});

describe("task schema checks after project code replaced built-ins", () => {
  it("records an output violation even when the task replaced Array slice and map", async () => {
    const originalSlice = Reflect.getOwnPropertyDescriptor(Array.prototype, "slice")!;
    const originalMap = Reflect.getOwnPropertyDescriptor(Array.prototype, "map")!;
    const task = makeTask({
      outputSchema: ticketOutputSchema,
      run: () => {
        Reflect.set(Array.prototype, "slice", () => {
          throw new Error("replaced Array.prototype.slice");
        });
        Reflect.set(Array.prototype, "map", () => {
          throw new Error("replaced Array.prototype.map");
        });
        return { category: "billing", confidence: "high" };
      },
    });

    let result: Awaited<ReturnType<typeof runTask>>;
    try {
      result = await runTask({ task, input: { ticketText: "x" } }, createInMemoryHostRuntime());
    } finally {
      Reflect.defineProperty(Array.prototype, "slice", originalSlice);
      Reflect.defineProperty(Array.prototype, "map", originalMap);
    }

    // The warning phase holds: the run completes with the returned value and a recorded mismatch.
    assertEquals(result.success, true);
    assertEquals(result.result, { category: "billing", confidence: "high" });
    assertEquals(result.schemaViolation?.phase, "output");
  });

  it("records a contract output violation even when the task replaced Array map", async () => {
    const outputSchema = defineSchema((v) => v.object({ confidence: v.number() }))();
    const originalMap = Reflect.getOwnPropertyDescriptor(Array.prototype, "map")!;
    const task = makeTask({
      outputSchema,
      run: () => {
        Reflect.set(Array.prototype, "map", () => {
          throw new Error("replaced Array.prototype.map");
        });
        return { confidence: "high" };
      },
    });

    let result: Awaited<ReturnType<typeof runTask>>;
    try {
      result = await runTask({ task, input: {} }, createInMemoryHostRuntime());
    } finally {
      Reflect.defineProperty(Array.prototype, "map", originalMap);
    }

    assertEquals(result.success, true);
    assertEquals(result.result, { confidence: "high" });
    assertEquals(result.schemaViolation?.phase, "output");
  });

  it("stamps an output violation even when the task replaced Date", async () => {
    const originalDate = Reflect.getOwnPropertyDescriptor(globalThis, "Date")!;
    const { task } = schemaTask({ outputSchema: ticketOutputSchema }, { confidence: "high" });
    const replacingTask = makeTask({
      ...task.definition,
      run: (ctx) => {
        Reflect.set(globalThis, "Date", class {});
        return task.definition.run(ctx);
      },
    });

    let result: Awaited<ReturnType<typeof runTask>>;
    try {
      result = await runTask({ task: replacingTask, input: {} }, createInMemoryHostRuntime());
    } finally {
      Reflect.defineProperty(globalThis, "Date", originalDate);
    }

    assertEquals(result.success, true);
    assertEquals(result.schemaViolation?.phase, "output");
    assertMatch(result.schemaViolation?.detected_at ?? "", /^\d{4}-\d{2}-\d{2}T/);
  });

  it("records a raw inputSchema identity when project code replaced Array.isArray", async () => {
    const originalIsArray = Reflect.getOwnPropertyDescriptor(Array, "isArray")!;
    const { task } = schemaTask({ inputSchema: ticketInputSchema });

    let result: Awaited<ReturnType<typeof runTask>>;
    try {
      Reflect.set(Array, "isArray", () => true);
      result = await runTask({ task, input: { ticketText: 42 } }, createInMemoryHostRuntime());
    } finally {
      Reflect.defineProperty(Array, "isArray", originalIsArray);
    }

    // The schema stays declared, so its identity is still recorded. Whether the registered
    // validator adapter survives the replaced global is up to the adapter.
    assertMatch(result.inputSchemaSha256 ?? "", /^[0-9a-f]{64}$/);
  });

  it("rejects invalid input against a contract inputSchema after discovery replaced Array map", async () => {
    const originalMap = Reflect.getOwnPropertyDescriptor(Array.prototype, "map")!;
    const inputSchema = defineSchema((v) => v.object({ ticketText: v.string().min(1) }))();
    const { task, calls } = schemaTask({ inputSchema });

    let result: Awaited<ReturnType<typeof runTask>>;
    try {
      // As a task module would at load time, before the runner validates submitted input.
      Reflect.set(Array.prototype, "map", () => {
        throw new Error("replaced Array.prototype.map");
      });
      result = await runTask({ task, input: { ticketText: 42 } }, createInMemoryHostRuntime());
    } finally {
      Reflect.defineProperty(Array.prototype, "map", originalMap);
    }

    assertEquals(result.success, false);
    assertEquals(result.errorCode, "INPUT_VALIDATION_FAILED");
    assertEquals(result.errorDetail?.errors[0]?.path, "/ticketText");
    assertEquals(calls.length, 0);
  });

  it("rejects invalid input against a raw JSON inputSchema after discovery replaced Array map", async () => {
    const originalMap = Reflect.getOwnPropertyDescriptor(Array.prototype, "map")!;
    const { task, calls } = schemaTask({ inputSchema: ticketInputSchema });

    let result: Awaited<ReturnType<typeof runTask>>;
    try {
      Reflect.set(Array.prototype, "map", () => {
        throw new Error("replaced Array.prototype.map");
      });
      result = await runTask({ task, input: { ticketText: 42 } }, createInMemoryHostRuntime());
    } finally {
      Reflect.defineProperty(Array.prototype, "map", originalMap);
    }

    assertEquals(result.success, false);
    assertEquals(result.errorCode, "INPUT_VALIDATION_FAILED");
    assertEquals(result.errorDetail?.errors[0]?.path, "/ticketText");
    assertEquals(calls.length, 0);
  });

  it("keeps the replaced built-in in place for the task after validation", async () => {
    const originalMap = Reflect.getOwnPropertyDescriptor(Array.prototype, "map")!;
    const replacement = () => "replaced";
    let seenByTask: unknown;
    const task = makeTask({
      inputSchema: defineSchema((v) => v.object({ ticketText: v.string() }))(),
      run: () => {
        seenByTask = Array.prototype.map;
        return {};
      },
    });

    let result: Awaited<ReturnType<typeof runTask>>;
    try {
      Reflect.set(Array.prototype, "map", replacement);
      result = await runTask({ task, input: { ticketText: "x" } }, createInMemoryHostRuntime());
    } finally {
      Reflect.defineProperty(Array.prototype, "map", originalMap);
    }

    assertEquals(result.success, true);
    assertEquals(seenByTask, replacement);
  });

  it("formats rejected input errors when project code replaced Array map and join", () => {
    const originalMap = Reflect.getOwnPropertyDescriptor(Array.prototype, "map")!;
    const originalJoin = Reflect.getOwnPropertyDescriptor(Array.prototype, "join")!;
    let summary: string | undefined;
    try {
      Reflect.set(Array.prototype, "map", () => {
        throw new Error("replaced Array.prototype.map");
      });
      Reflect.set(Array.prototype, "join", () => {
        throw new Error("replaced Array.prototype.join");
      });
      summary = formatSchemaValidationErrors([
        { path: "/ticketText", message: "Expected string" },
        { path: "", message: "Required" },
      ]);
    } finally {
      Reflect.defineProperty(Array.prototype, "map", originalMap);
      Reflect.defineProperty(Array.prototype, "join", originalJoin);
    }

    assertEquals(summary, "/ticketText: Expected string; <root>: Required");
  });

  it("escapes JSON Pointer segments when project code replaced String replaceAll", () => {
    const originalReplaceAll = Reflect.getOwnPropertyDescriptor(String.prototype, "replaceAll")!;
    let escaped: string | undefined;
    try {
      Reflect.set(String.prototype, "replaceAll", () => {
        throw new Error("replaced String.prototype.replaceAll");
      });
      escaped = escapePointerSegment("a/b~c");
    } finally {
      Reflect.defineProperty(String.prototype, "replaceAll", originalReplaceAll);
    }

    assertEquals(escaped, "a~1b~0c");
  });
});

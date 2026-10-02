/** Async JSON Schema validation after task discovery replaces shared built-ins. */
import "#veryfront/schemas/_test-setup.ts";
import type { JsonSchema } from "#veryfront/extensions/schema/index.ts";
import { createInMemoryHostRuntime } from "#veryfront/platform/compat/process.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { runTask } from "#veryfront/task/runner.ts";
import { createZodAdapter } from "../../../extensions/ext-schema-zod/src/adapter.ts";

const inputSchema = {
  $async: true,
  type: "object",
  properties: { ticketText: { type: "string", minLength: 1 } },
  required: ["ticketText"],
  additionalProperties: false,
} satisfies JsonSchema;

describe("async JSON Schema validation with replaced built-ins", () => {
  it("maps rejected validation errors after the synchronous guard ends", async () => {
    const validator = createZodAdapter().compileJsonSchema!(inputSchema);
    const originalMap = Reflect.getOwnPropertyDescriptor(Array.prototype, "map")!;
    const pending = validator({ ticketText: 42 });
    let result: Awaited<ReturnType<typeof validator>>;
    try {
      Reflect.set(Array.prototype, "map", () => {
        throw new Error("replaced Array.prototype.map");
      });
      result = await pending;
    } finally {
      Reflect.defineProperty(Array.prototype, "map", originalMap);
    }

    assertEquals(result.success, false);
    if (!result.success) {
      assertEquals(result.errors[0]?.instancePath, "/ticketText");
      assertEquals(result.errors[0]?.keyword, "type");
    }
  });

  it("rejects invalid input before run when discovery replaced Array map", async () => {
    const originalMap = Reflect.getOwnPropertyDescriptor(Array.prototype, "map")!;
    let calls = 0;
    let result: Awaited<ReturnType<typeof runTask>>;
    try {
      Reflect.set(Array.prototype, "map", () => {
        throw new Error("replaced Array.prototype.map");
      });
      result = await runTask({
        task: {
          id: "async-schema",
          name: "async-schema",
          definition: {
            inputSchema,
            run: () => {
              calls++;
              return "unexpected";
            },
          },
        },
        input: { ticketText: 42 },
      }, createInMemoryHostRuntime());
    } finally {
      Reflect.defineProperty(Array.prototype, "map", originalMap);
    }

    assertEquals(calls, 0);
    assertEquals(result.success, false);
    assertEquals(result.errorCode, "INPUT_VALIDATION_FAILED");
    assertEquals(result.errorDetail?.errors[0]?.path, "/ticketText");
  });

  it("accepts valid async input and preserves the task's replaced Array map", async () => {
    const originalMap = Reflect.getOwnPropertyDescriptor(Array.prototype, "map")!;
    const replacedMap = () => {
      throw new Error("replaced Array.prototype.map");
    };
    let result: Awaited<ReturnType<typeof runTask>>;
    try {
      Reflect.set(Array.prototype, "map", replacedMap);
      result = await runTask({
        task: {
          id: "async-schema-valid",
          name: "async-schema-valid",
          definition: {
            inputSchema,
            run: () => Array.prototype.map === replacedMap,
          },
        },
        input: { ticketText: "valid" },
      }, createInMemoryHostRuntime());
    } finally {
      Reflect.defineProperty(Array.prototype, "map", originalMap);
    }

    assertEquals(result.success, true);
    assertEquals(result.result, true);
  });
});

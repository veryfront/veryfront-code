import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createRuntimeJsonSchema } from "#veryfront/agent/runtime/runtime-tool-builder.ts";
import type {
  ModelRuntime,
  ModelRuntimeCallOptions,
  ModelRuntimeGenerateResult,
} from "#veryfront/provider/types.ts";
import { generateText, streamText } from "./runtime-bridge.ts";
import { collectAsync } from "./runtime-bridge.test-helpers.ts";

const MAX_TOOL_CALLS = 128;
const MAX_TOOL_INPUT_BYTES = 1_048_576;
const MAX_AGGREGATE_TOOL_INPUT_BYTES = 8 * 1_048_576;
const MAX_SYSTEM_PROMPT_PARTS = 1_024;

function readableFrom(parts: readonly unknown[]): ReadableStream<unknown> {
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index >= parts.length) {
        controller.close();
        return;
      }
      controller.enqueue(parts[index++]);
    },
  });
}

function directModel(
  result: unknown,
  onGenerate?: () => void,
): ModelRuntime {
  return {
    provider: "boundary",
    modelId: "boundary/direct",
    specificationVersion: "v3",
    doGenerate: () => {
      onGenerate?.();
      return Promise.resolve(result as ModelRuntimeGenerateResult);
    },
    doStream: () => Promise.reject(new Error("unused doStream")),
  };
}

function streamModel(parts: readonly unknown[]): ModelRuntime {
  return {
    provider: "boundary",
    modelId: "boundary/stream",
    specificationVersion: "v3",
    doGenerate: () => Promise.reject(new Error("unused doGenerate")),
    doStream: () => Promise.resolve({ stream: readableFrom(parts) }),
  };
}

function permissiveTools() {
  return {
    search: {
      description: "Search",
      inputSchema: createRuntimeJsonSchema({ type: "object" }),
    },
  };
}

function arrayTools() {
  return {
    search: {
      description: "Search",
      inputSchema: createRuntimeJsonSchema({
        type: "array",
        items: { type: "string" },
      }),
    },
  };
}

function queryTools() {
  return {
    search: {
      description: "Search",
      inputSchema: createRuntimeJsonSchema({
        type: "object",
        required: ["query"],
        properties: {
          query: { type: "string" },
        },
      }),
    },
  };
}

function getErrorName(value: unknown): string | undefined {
  return value && typeof value === "object" && "name" in value &&
      typeof value.name === "string"
    ? value.name
    : undefined;
}

function streamToolErrors(parts: readonly unknown[]): Array<{
  toolCallId?: unknown;
  error?: unknown;
}> {
  return parts.filter((part) =>
    part && typeof part === "object" && "type" in part &&
    part.type === "tool-error"
  ) as Array<{ toolCallId?: unknown; error?: unknown }>;
}

function exactByteJsonInput(byteLength: number): string {
  const prefix = '{"payload":"';
  const suffix = '"}';
  const input = `${prefix}${"x".repeat(byteLength - prefix.length - suffix.length)}${suffix}`;
  assertEquals(new TextEncoder().encode(input).byteLength, byteLength);
  return input;
}

describe("runtime bridge boundary validation", () => {
  it("contains an overflowed JSON number from replay history as a correlated tool error", async () => {
    let generated = false;
    const result = await generateText({
      model: directModel(
        {
          content: [{ type: "text", text: "Recovered." }],
          finishReason: "stop",
        },
        () => {
          generated = true;
        },
      ),
      messages: [{
        role: "assistant",
        content: [],
        providerToolCalls: [{
          type: "tool-call",
          toolCallId: "replayed-overflow",
          toolName: "web_search",
          input: "1e999",
          providerExecuted: true,
        }],
      }],
      tools: {
        web_search: {
          type: "provider",
          id: "anthropic.web_search_20250305",
          args: {},
          inputSchema: () => createRuntimeJsonSchema({ type: "number" }),
        },
      },
    });

    assertEquals(generated, true);
    assertEquals(result.text, "Recovered.");
    assertEquals(result.toolResults?.length, 1);
    assertEquals(result.toolResults?.[0]?.toolCallId, "replayed-overflow");
    assertEquals(
      getErrorName(result.toolResults?.[0]?.result),
      "AI_MissingToolResultError",
    );
  });

  it("contains an overflowed streamed JSON number as a correlated tool error", async () => {
    const result = await generateText({
      model: {
        ...streamModel([
          {
            type: "tool-call",
            toolCallId: "streamed-overflow",
            toolName: "search",
            input: "1e999",
          },
          { type: "finish", finishReason: "tool-calls" },
        ]),
        _generateViaStream: true,
      },
      messages: [{ role: "user", content: "Search" }],
      tools: {
        search: {
          description: "Search",
          inputSchema: createRuntimeJsonSchema({ type: "number" }),
        },
      },
    });

    assertEquals(result.toolCalls?.length, 1);
    assertEquals(result.toolCalls?.[0]?.toolCallId, "streamed-overflow");
    assertEquals(result.toolCalls?.[0]?.input, "1e999");
    assertEquals(result.toolResults?.length, 1);
    assertEquals(result.toolResults?.[0]?.toolCallId, "streamed-overflow");
    assertEquals(
      getErrorName(result.toolResults?.[0]?.result),
      "AI_InvalidToolInputError",
    );
  });

  it("preserves every supported system prompt representation", async () => {
    const cases: Array<{
      system: unknown;
      expected: string;
    }> = [
      { system: "plain system", expected: "plain system" },
      { system: { content: "object system" }, expected: "object system" },
      {
        system: [{ content: "first system" }, { content: "second system" }],
        expected: "first system\nsecond system",
      },
    ];

    for (const { system, expected } of cases) {
      let capturedPrompt: unknown;
      const model: ModelRuntime<ModelRuntimeCallOptions> = {
        provider: "boundary",
        modelId: "boundary/system-contract",
        specificationVersion: "v3",
        doGenerate: (options) => {
          capturedPrompt = options.prompt;
          return Promise.resolve({
            content: [{ type: "text", text: "ok" }],
            finishReason: "stop",
          });
        },
        doStream: () => Promise.reject(new Error("unused doStream")),
      };

      await generateText({
        model,
        system,
        messages: [{ role: "user", content: "Hello" }],
      });

      assertEquals(capturedPrompt, [
        { role: "system", content: expected },
        {
          role: "user",
          content: [{ type: "text", text: "Hello" }],
        },
      ]);
    }
  });

  const malformedSystems: Array<{ name: string; system: unknown }> = [
    {
      name: "rejects a system object whose content is not text",
      system: { content: 42 },
    },
    {
      name: "rejects an array with a malformed system entry instead of dropping it",
      system: [{ content: "security policy" }, { content: 42 }],
    },
    {
      name: "rejects unsupported non-null system primitives",
      system: 42,
    },
  ];

  for (const { name, system } of malformedSystems) {
    it(name, async () => {
      let providerCalled = false;

      await assertRejects(
        () =>
          Promise.resolve(generateText({
            model: directModel({
              content: [{ type: "text", text: "unsafe" }],
              finishReason: "stop",
            }, () => {
              providerCalled = true;
            }),
            system,
            messages: [{ role: "user", content: "Hello" }],
          })),
        TypeError,
      );

      assertEquals(providerCalled, false);
    });
  }

  it("rejects accessor-backed system content without invoking it", async () => {
    let accessorInvoked = false;
    let providerCalled = false;
    const system: Record<string, unknown> = {};
    Object.defineProperty(system, "content", {
      enumerable: true,
      get() {
        accessorInvoked = true;
        return "unsafe";
      },
    });

    await assertRejects(
      () =>
        Promise.resolve(generateText({
          model: directModel({
            content: [{ type: "text", text: "unsafe" }],
            finishReason: "stop",
          }, () => {
            providerCalled = true;
          }),
          system,
          messages: [{ role: "user", content: "Hello" }],
        })),
      TypeError,
    );

    assertEquals(accessorInvoked, false);
    assertEquals(providerCalled, false);
  });

  it("sanitizes forged system-prompt TypeError prefixes from proxy traps", async () => {
    let providerCalled = false;
    const system = new Proxy({}, {
      getOwnPropertyDescriptor() {
        throw new TypeError(
          `Runtime system prompt ${"attacker-detail".repeat(10_000)}`,
        );
      },
    });

    const error = await assertRejects(
      () =>
        Promise.resolve(generateText({
          model: directModel({
            content: [{ type: "text", text: "unsafe" }],
            finishReason: "stop",
          }, () => {
            providerCalled = true;
          }),
          system,
          messages: [{ role: "user", content: "Hello" }],
        })),
      TypeError,
      "could not be safely inspected",
    );

    assertEquals(
      (error as Error).message,
      "Runtime system prompt could not be safely inspected",
    );
    assertEquals(providerCalled, false);
  });

  it("rejects a huge sparse system array before inspecting numeric entries", async () => {
    let numericDescriptorCalls = 0;
    let providerCalled = false;
    const sparse = new Array(MAX_SYSTEM_PROMPT_PARTS + 1);
    const system = new Proxy(sparse, {
      getOwnPropertyDescriptor(target, key) {
        if (typeof key === "string" && /^\d+$/.test(key)) {
          numericDescriptorCalls++;
        }
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });

    await assertRejects(
      () =>
        Promise.resolve(generateText({
          model: directModel({
            content: [{ type: "text", text: "unsafe" }],
            finishReason: "stop",
          }, () => {
            providerCalled = true;
          }),
          system,
          messages: [{ role: "user", content: "Hello" }],
        })),
      TypeError,
      "must contain at most",
    );

    assertEquals(numericDescriptorCalls, 0);
    assertEquals(providerCalled, false);
  });

  it("bounds the joined system prompt before provider invocation", async () => {
    let providerCalled = false;
    await assertRejects(
      () =>
        Promise.resolve(generateText({
          model: directModel({
            content: [{ type: "text", text: "unsafe" }],
            finishReason: "stop",
          }, () => {
            providerCalled = true;
          }),
          system: [
            { content: "x".repeat(700_000) },
            { content: "y".repeat(400_000) },
          ],
          messages: [{ role: "user", content: "Hello" }],
        })),
      TypeError,
      "must not exceed",
    );
    assertEquals(providerCalled, false);
  });

  const malformedContentContainers: Array<{ name: string; content: unknown }> = [
    {
      name: "rejects a string direct-result content container",
      content: "not an array",
    },
    {
      name: "rejects a record direct-result content container",
      content: { type: "text", text: "not an array" },
    },
    {
      name: "rejects a null direct-result content container",
      content: null,
    },
  ];

  for (const { name, content } of malformedContentContainers) {
    it(name, async () => {
      await assertRejects(
        () =>
          Promise.resolve(generateText({
            model: directModel({ content, finishReason: "stop" }),
            messages: [{ role: "user", content: "Hello" }],
          })),
        TypeError,
      );
    });
  }

  const malformedKnownParts: Array<{ name: string; part: unknown }> = [
    {
      name: "rejects a malformed known text part instead of omitting it",
      part: { type: "text", text: 42 },
    },
    {
      name: "rejects a malformed known tool-call part instead of omitting it",
      part: {
        type: "tool-call",
        toolCallId: 42,
        toolName: "search",
        input: {},
      },
    },
    {
      name: "rejects a malformed known tool-result part instead of omitting it",
      part: {
        type: "tool-result",
        toolCallId: "call-1",
        toolName: "search",
      },
    },
  ];

  for (const { name, part } of malformedKnownParts) {
    it(name, async () => {
      await assertRejects(
        () =>
          Promise.resolve(generateText({
            model: directModel({
              content: [part],
              finishReason: "stop",
            }),
            messages: [{ role: "user", content: "Hello" }],
            tools: permissiveTools(),
          })),
        TypeError,
      );
    });
  }

  it("continues to ignore unknown provider-specific direct-result parts", async () => {
    const result = await generateText({
      model: directModel({
        content: [
          {
            type: "provider-metadata",
            providerPayload: { opaque: true },
          },
          { type: "text", text: "kept" },
        ],
        finishReason: "stop",
      }),
      messages: [{ role: "user", content: "Hello" }],
    });

    assertEquals(result.text, "kept");
  });
});

describe("runtime bridge tool input resource budgets", () => {
  for (const path of ["direct", "streamed"] as const) {
    it(`${path}: validates and emits one owned plain structured input snapshot`, async () => {
      let validatedInput: unknown;
      const input = {
        query: "safe",
        nested: ["value"],
      };
      const tools = {
        search: {
          description: "Search",
          inputSchema: {
            jsonSchema: { type: "object" },
            validate(value: unknown) {
              validatedInput = value;
              return { success: true as const, value };
            },
          },
        },
      };

      if (path === "direct") {
        const result = await generateText({
          model: directModel({
            content: [{
              type: "tool-call",
              toolCallId: "direct-owned-input",
              toolName: "search",
              input,
            }],
            finishReason: "tool-calls",
          }),
          messages: [{ role: "user", content: "Search" }],
          tools,
        });

        assertEquals(validatedInput, input);
        assertEquals(validatedInput === input, false);
        assertEquals(Object.isFrozen(validatedInput), true);
        assertEquals(result.toolCalls?.[0]?.input === validatedInput, true);
        assertEquals(result.toolCalls?.[0]?.input, input);
      } else {
        const result = streamText({
          model: streamModel([
            {
              type: "tool-input-start",
              id: "stream-owned-input",
              toolName: "search",
            },
            {
              type: "tool-call",
              toolCallId: "stream-owned-input",
              toolName: "search",
              input,
            },
            { type: "finish", finishReason: "tool-calls" },
          ]),
          messages: [{ role: "user", content: "Search" }],
          tools,
        });
        const parts = await collectAsync(result.fullStream);
        const inputDeltas = parts.filter((part) =>
          part && typeof part === "object" && "type" in part &&
          part.type === "tool-input-delta"
        ) as Array<{ delta: string }>;
        const toolCall = parts.find((part) =>
          part && typeof part === "object" && "type" in part &&
          part.type === "tool-call"
        ) as { input?: unknown } | undefined;

        assertEquals(validatedInput, input);
        assertEquals(validatedInput === input, false);
        assertEquals(Object.isFrozen(validatedInput), true);
        assertEquals(toolCall?.input === validatedInput, true);
        assertEquals(
          inputDeltas.map(({ delta }) => delta),
          ['{"query":"safe","nested":["value"]}'],
        );
        assertEquals(
          inputDeltas.every((part) =>
            new TextEncoder().encode(part.delta).byteLength <=
              MAX_TOOL_INPUT_BYTES
          ),
          true,
        );
      }
    });
  }

  for (const path of ["direct", "streamed"] as const) {
    it(`${path}: rejects structured hooks and non-JSON own properties before validation`, async () => {
      let hookCalls = 0;
      let validationCalls = 0;
      const accessorInput = { query: "safe" };
      Object.defineProperty(accessorInput, "hidden", {
        get() {
          hookCalls++;
          return "unsafe";
        },
      });
      const inputs: unknown[] = [
        {
          query: "safe",
          toJSON() {
            hookCalls++;
            return {};
          },
        },
        {
          query: "safe",
          toString() {
            hookCalls++;
            return "unsafe";
          },
        },
        {
          query: "safe",
          [Symbol.toPrimitive]() {
            hookCalls++;
            return "unsafe";
          },
        },
        { query: "safe", callback: () => hookCalls++ },
        accessorInput,
      ];
      const tools = {
        search: {
          description: "Search",
          inputSchema: {
            jsonSchema: { type: "object" },
            validate(value: unknown) {
              validationCalls++;
              return { success: true as const, value };
            },
          },
        },
      };

      for (let index = 0; index < inputs.length; index++) {
        const input = inputs[index];
        if (path === "direct") {
          await assertRejects(
            () =>
              Promise.resolve(generateText({
                model: directModel({
                  content: [{
                    type: "tool-call",
                    toolCallId: `direct-hook-${index}`,
                    toolName: "search",
                    input,
                  }],
                  finishReason: "tool-calls",
                }),
                messages: [{ role: "user", content: "Search" }],
                tools,
              })),
            TypeError,
            "Runtime tool input",
          );
        } else {
          const result = streamText({
            model: streamModel([
              {
                type: "tool-call",
                toolCallId: `stream-hook-${index}`,
                toolName: "search",
                input,
              },
              { type: "finish", finishReason: "tool-calls" },
            ]),
            messages: [{ role: "user", content: "Search" }],
            tools,
          });
          await assertRejects(
            () => collectAsync(result.fullStream),
            TypeError,
            "Runtime tool input",
          );
        }
      }

      assertEquals(validationCalls, 0);
      assertEquals(hookCalls, 0);
    });
  }

  for (const path of ["direct", "streamed"] as const) {
    it(`${path}: rejects array-index accessors before schema validation`, async () => {
      let getterCalls = 0;
      const input = new Array(1);
      Object.defineProperty(input, "0", {
        enumerable: true,
        get() {
          getterCalls++;
          return "x".repeat(MAX_TOOL_INPUT_BYTES + 1);
        },
      });

      if (path === "direct") {
        await assertRejects(
          () =>
            Promise.resolve(generateText({
              model: directModel({
                content: [{
                  type: "tool-call",
                  toolCallId: "direct-array-accessor",
                  toolName: "search",
                  input,
                }],
                finishReason: "tool-calls",
              }),
              messages: [{ role: "user", content: "Search" }],
              tools: arrayTools(),
            })),
          TypeError,
          "inspectable data properties",
        );
      } else {
        const result = streamText({
          model: streamModel([
            {
              type: "tool-call",
              toolCallId: "stream-array-accessor",
              toolName: "search",
              input,
            },
            { type: "finish", finishReason: "tool-calls" },
          ]),
          messages: [{ role: "user", content: "Search" }],
          tools: arrayTools(),
        });
        await assertRejects(
          () => collectAsync(result.fullStream),
          TypeError,
          "inspectable data properties",
        );
      }

      assertEquals(getterCalls, 0);
    });
  }

  it("snapshots every direct input before the first validator can mutate a later call", async () => {
    const secondInput = { query: "original" };
    let validationCalls = 0;
    let secondValidatedInput: unknown;
    const tools = {
      search: {
        description: "Search",
        inputSchema: {
          jsonSchema: { type: "object" },
          async validate(value: unknown) {
            validationCalls++;
            if (validationCalls === 1) {
              secondInput.query = "mutated";
              await Promise.resolve();
            } else {
              secondValidatedInput = value;
            }
            return { success: true as const, value };
          },
        },
      },
    };

    const result = await generateText({
      model: directModel({
        content: [
          {
            type: "tool-call",
            toolCallId: "direct-toctou-first",
            toolName: "search",
            input: { query: "first" },
          },
          {
            type: "tool-call",
            toolCallId: "direct-toctou-second",
            toolName: "search",
            input: secondInput,
          },
        ],
        finishReason: "tool-calls",
      }),
      messages: [{ role: "user", content: "Search" }],
      tools,
    });

    assertEquals(validationCalls, 2);
    assertEquals(secondValidatedInput, { query: "original" });
    assertEquals(result.toolCalls?.[1]?.input, { query: "original" });
  });

  it("snapshots a complete streamed input before flushing an earlier validator", async () => {
    const secondInput = { query: "original" };
    let validationCalls = 0;
    let secondValidatedInput: unknown;
    const tools = {
      search: {
        description: "Search",
        inputSchema: {
          jsonSchema: { type: "object" },
          async validate(value: unknown) {
            validationCalls++;
            if (validationCalls === 1) {
              secondInput.query = "mutated";
              await Promise.resolve();
            } else {
              secondValidatedInput = value;
            }
            return { success: true as const, value };
          },
        },
      },
    };
    const result = streamText({
      model: streamModel([
        {
          type: "tool-input-start",
          id: "stream-toctou-first",
          toolName: "search",
        },
        {
          type: "tool-input-delta",
          id: "stream-toctou-first",
          delta: '{"query":"first"}',
        },
        { type: "tool-input-end", id: "stream-toctou-first" },
        {
          type: "tool-call",
          toolCallId: "stream-toctou-second",
          toolName: "search",
          input: secondInput,
        },
        { type: "finish", finishReason: "tool-calls" },
      ]),
      messages: [{ role: "user", content: "Search" }],
      tools,
    });

    const parts = await collectAsync(result.fullStream);
    const calls = parts.filter((part) =>
      part && typeof part === "object" && "type" in part &&
      part.type === "tool-call"
    ) as Array<{ toolCallId: string; input: unknown }>;
    assertEquals(validationCalls, 2);
    assertEquals(secondValidatedInput, { query: "original" });
    assertEquals(
      calls.find((call) => call.toolCallId === "stream-toctou-second")?.input,
      { query: "original" },
    );
  });

  for (const path of ["direct", "streamed"] as const) {
    it(`${path}: snapshots and emits a distinct validator transformation`, async () => {
      let returnedTransformation: unknown;
      const tools = {
        search: {
          description: "Search",
          inputSchema: {
            jsonSchema: { type: "object" },
            validate() {
              returnedTransformation = {
                normalized: "safe",
                nested: ["owned"],
              };
              return {
                success: true as const,
                value: returnedTransformation,
              };
            },
          },
        },
      };

      let emittedInput: unknown;
      if (path === "direct") {
        const result = await generateText({
          model: directModel({
            content: [{
              type: "tool-call",
              toolCallId: "direct-validator-transform",
              toolName: "search",
              input: { query: "raw" },
            }],
            finishReason: "tool-calls",
          }),
          messages: [{ role: "user", content: "Search" }],
          tools,
        });
        emittedInput = result.toolCalls?.[0]?.input;
      } else {
        const result = streamText({
          model: streamModel([
            {
              type: "tool-call",
              toolCallId: "stream-validator-transform",
              toolName: "search",
              input: { query: "raw" },
            },
            { type: "finish", finishReason: "tool-calls" },
          ]),
          messages: [{ role: "user", content: "Search" }],
          tools,
        });
        const parts = await collectAsync(result.fullStream);
        emittedInput = (parts.find((part) =>
          part && typeof part === "object" && "type" in part &&
          part.type === "tool-call"
        ) as { input?: unknown } | undefined)?.input;
      }

      assertEquals(emittedInput, {
        normalized: "safe",
        nested: ["owned"],
      });
      assertEquals(emittedInput === returnedTransformation, false);
      assertEquals(Object.isFrozen(emittedInput), true);
      assertEquals(
        Object.isFrozen((emittedInput as { nested: unknown[] }).nested),
        true,
      );
    });
  }

  for (const path of ["direct", "streamed"] as const) {
    it(`${path}: correlates an accessor-backed validator transformation uninvoked`, async () => {
      let getterCalls = 0;
      const transformed: Record<string, unknown> = {};
      Object.defineProperty(transformed, "query", {
        enumerable: true,
        get() {
          getterCalls++;
          return "unsafe";
        },
      });
      const tools = {
        search: {
          description: "Search",
          inputSchema: {
            jsonSchema: { type: "object" },
            validate() {
              return { success: true as const, value: transformed };
            },
          },
        },
      };

      let error: unknown;
      if (path === "direct") {
        const result = await generateText({
          model: directModel({
            content: [{
              type: "tool-call",
              toolCallId: "direct-hostile-transform",
              toolName: "search",
              input: {},
            }],
            finishReason: "tool-calls",
          }),
          messages: [{ role: "user", content: "Search" }],
          tools,
        });
        error = result.toolResults?.[0]?.result;
      } else {
        const result = streamText({
          model: streamModel([
            {
              type: "tool-call",
              toolCallId: "stream-hostile-transform",
              toolName: "search",
              input: {},
            },
            { type: "finish", finishReason: "tool-calls" },
          ]),
          messages: [{ role: "user", content: "Search" }],
          tools,
        });
        error = streamToolErrors(await collectAsync(result.fullStream))[0]?.error;
      }

      assertEquals(getErrorName(error), "AI_InvalidToolInputError");
      assertEquals(getterCalls, 0);
    });
  }

  it("correlates a revoked validator transformation without leaking engine diagnostics", async () => {
    const transformed = Proxy.revocable({}, {});
    transformed.revoke();
    const result = await generateText({
      model: directModel({
        content: [{
          type: "tool-call",
          toolCallId: "direct-revoked-transform",
          toolName: "search",
          input: {},
        }],
        finishReason: "tool-calls",
      }),
      messages: [{ role: "user", content: "Search" }],
      tools: {
        search: {
          description: "Search",
          inputSchema: {
            jsonSchema: { type: "object" },
            validate() {
              return { success: true as const, value: transformed.proxy };
            },
          },
        },
      },
    });
    const error = result.toolResults?.[0]?.result as Error | undefined;

    assertEquals(getErrorName(error), "AI_InvalidToolInputError");
    assertEquals(error?.message.includes("revoked"), false);
  });

  for (const path of ["direct", "streamed"] as const) {
    it(`${path}: correlates an oversized validator transformation as a limit error`, async () => {
      const oversized = exactByteJsonInput(MAX_TOOL_INPUT_BYTES + 1);
      const tools = {
        search: {
          description: "Search",
          inputSchema: {
            jsonSchema: { type: "object" },
            validate() {
              return { success: true as const, value: oversized };
            },
          },
        },
      };

      if (path === "direct") {
        const result = await generateText({
          model: directModel({
            content: [{
              type: "tool-call",
              toolCallId: "direct-oversized-transform",
              toolName: "search",
              input: {},
            }],
            finishReason: "tool-calls",
          }),
          messages: [{ role: "user", content: "Search" }],
          tools,
        });
        assertEquals(result.toolCalls?.length ?? 0, 0);
        assertEquals(
          getErrorName(result.toolResults?.[0]?.result),
          "AI_ToolInputLimitError",
        );
      } else {
        const result = streamText({
          model: streamModel([
            {
              type: "tool-call",
              toolCallId: "stream-oversized-transform",
              toolName: "search",
              input: {},
            },
            { type: "finish", finishReason: "tool-calls" },
          ]),
          messages: [{ role: "user", content: "Search" }],
          tools,
        });
        const errors = streamToolErrors(await collectAsync(result.fullStream));
        assertEquals(errors.length, 1);
        assertEquals(getErrorName(errors[0]?.error), "AI_ToolInputLimitError");
      }
    });
  }

  it("preserves the exact raw JSON formatting of a complete streamed call", async () => {
    const rawInput = ' \n { "query" : "safe" } \t';
    const tools = {
      search: {
        description: "Search",
        inputSchema: {
          jsonSchema: { type: "object" },
          validate(value: unknown) {
            return { success: true as const, value };
          },
        },
      },
    };
    const result = streamText({
      model: streamModel([
        {
          type: "tool-call",
          toolCallId: "stream-raw-format",
          toolName: "search",
          input: rawInput,
        },
        { type: "finish", finishReason: "tool-calls" },
      ]),
      messages: [{ role: "user", content: "Search" }],
      tools,
    });
    const parts = await collectAsync(result.fullStream);
    const call = parts.find((part) =>
      part && typeof part === "object" && "type" in part &&
      part.type === "tool-call"
    ) as { input?: unknown } | undefined;
    assertEquals(call?.input, rawInput);
  });

  it("densifies sparse arrays without invoking inherited serialization hooks", async () => {
    const priorToJSON = Object.getOwnPropertyDescriptor(Array.prototype, "toJSON");
    let hookCalls = 0;
    let validatedInput: unknown;
    const input = new Array(2);
    input[1] = "safe";
    const tools = {
      search: {
        description: "Search",
        inputSchema: {
          jsonSchema: { type: "array" },
          validate(value: unknown) {
            validatedInput = value;
            return { success: true as const, value };
          },
        },
      },
    };

    try {
      Object.defineProperty(Array.prototype, "toJSON", {
        configurable: true,
        value() {
          hookCalls++;
          return ["unsafe"];
        },
      });
      const result = streamText({
        model: streamModel([
          {
            type: "tool-input-start",
            id: "stream-sparse-array",
            toolName: "search",
          },
          {
            type: "tool-call",
            toolCallId: "stream-sparse-array",
            toolName: "search",
            input,
          },
          { type: "finish", finishReason: "tool-calls" },
        ]),
        messages: [{ role: "user", content: "Search" }],
        tools,
      });
      const parts = await collectAsync(result.fullStream);
      const deltas = parts.filter((part) =>
        part && typeof part === "object" && "type" in part &&
        part.type === "tool-input-delta"
      ) as Array<{ delta: string }>;

      assertEquals(validatedInput, [null, "safe"]);
      assertEquals(deltas.map(({ delta }) => delta), ['[null,"safe"]']);
      assertEquals(hookCalls, 0);
    } finally {
      if (priorToJSON) {
        Object.defineProperty(Array.prototype, "toJSON", priorToJSON);
      } else {
        delete (Array.prototype as { toJSON?: unknown }).toJSON;
      }
    }
  });

  it("contains malformed validator results as correlated input errors without getters", async () => {
    let getterCalls = 0;
    const accessorResult: Record<string, unknown> = {};
    Object.defineProperty(accessorResult, "success", {
      enumerable: true,
      get() {
        getterCalls++;
        return true;
      },
    });
    const revokedResult = Proxy.revocable({}, {});
    revokedResult.revoke();
    const validatorResults = [
      accessorResult,
      revokedResult.proxy,
    ];

    for (let index = 0; index < validatorResults.length; index++) {
      const result = await generateText({
        model: directModel({
          content: [{
            type: "tool-call",
            toolCallId: `malformed-validator-${index}`,
            toolName: "search",
            input: {},
          }],
          finishReason: "tool-calls",
        }),
        messages: [{ role: "user", content: "Search" }],
        tools: {
          search: {
            description: "Search",
            inputSchema: {
              jsonSchema: { type: "object" },
              validate() {
                return validatorResults[index] as never;
              },
            },
          },
        },
      });
      const error = result.toolResults?.[0]?.result;
      assertEquals(getErrorName(error), "AI_InvalidToolInputError");
      assertEquals((error as Error).message.includes("revoked"), false);
    }

    assertEquals(getterCalls, 0);
  });

  it("bounds validation issue text and aggregate params before retaining diagnostics", async () => {
    const oversizedTextResult = {
      success: false as const,
      errors: [{
        instancePath: "",
        schemaPath: "#/properties/query",
        keyword: "type",
        params: {},
        message: "x".repeat(4_097),
      }],
    };
    const aggregateParamsResult = {
      success: false as const,
      errors: Array.from({ length: 18 }, () => ({
        instancePath: "",
        schemaPath: "#/properties/query",
        keyword: "type",
        params: { payload: "x".repeat(60_000) },
        message: "invalid",
      })),
    };

    for (
      const [index, validationResult] of [
        oversizedTextResult,
        aggregateParamsResult,
      ].entries()
    ) {
      const result = await generateText({
        model: directModel({
          content: [{
            type: "tool-call",
            toolCallId: `bounded-validation-errors-${index}`,
            toolName: "search",
            input: {},
          }],
          finishReason: "tool-calls",
        }),
        messages: [{ role: "user", content: "Search" }],
        tools: {
          search: {
            description: "Search",
            inputSchema: {
              jsonSchema: { type: "object" },
              validate() {
                return validationResult;
              },
            },
          },
        },
      });
      const error = result.toolResults?.[0]?.result as Error | undefined;
      assertEquals(getErrorName(error), "AI_InvalidToolInputError");
      assertEquals((error?.message.length ?? 0) < 1_024, true);
    }
  });

  for (const path of ["direct", "streamed"] as const) {
    it(`${path}: gives repair an owned input and contains unsupported repaired data`, async () => {
      const originalInput = { query: 42 };
      let getterCalls = 0;
      let repairInput: unknown;
      const badInput: Record<string, unknown> = {};
      Object.defineProperty(badInput, "query", {
        enumerable: true,
        get() {
          getterCalls++;
          return "unsafe";
        },
      });
      const repair = (context: {
        toolCall: {
          type: "tool-call";
          toolCallId: string;
          toolName: string;
          input: unknown;
        };
      }) => {
        repairInput = context.toolCall.input;
        return { ...context.toolCall, input: badInput };
      };

      let repairError: unknown;
      if (path === "direct") {
        const result = await generateText({
          model: directModel({
            content: [{
              type: "tool-call",
              toolCallId: "direct-unsupported-repair",
              toolName: "search",
              input: originalInput,
            }],
            finishReason: "tool-calls",
          }),
          messages: [{ role: "user", content: "Search" }],
          tools: queryTools(),
          experimental_repairToolCall: repair as never,
        });
        repairError = result.toolResults?.[0]?.result;
      } else {
        const result = streamText({
          model: streamModel([
            {
              type: "tool-call",
              toolCallId: "stream-unsupported-repair",
              toolName: "search",
              input: originalInput,
            },
            { type: "finish", finishReason: "tool-calls" },
          ]),
          messages: [{ role: "user", content: "Search" }],
          tools: queryTools(),
          experimental_repairToolCall: repair as never,
        });
        const errors = streamToolErrors(await collectAsync(result.fullStream));
        repairError = errors[0]?.error;
      }

      assertEquals(repairInput, originalInput);
      assertEquals(repairInput === originalInput, false);
      assertEquals(Object.isFrozen(repairInput), true);
      assertEquals(getErrorName(repairError), "AI_ToolCallRepairError");
      assertEquals(getterCalls, 0);
    });
  }

  for (const path of ["direct", "streamed"] as const) {
    it(`${path}: reports an oversized repaired input as a correlated limit error`, async () => {
      const oversized = exactByteJsonInput(MAX_TOOL_INPUT_BYTES + 1);
      const repair = (context: {
        toolCall: {
          type: "tool-call";
          toolCallId: string;
          toolName: string;
          input: unknown;
        };
      }) => ({ ...context.toolCall, input: oversized });

      let error: unknown;
      if (path === "direct") {
        const result = await generateText({
          model: directModel({
            content: [{
              type: "tool-call",
              toolCallId: "direct-oversized-repair",
              toolName: "search",
              input: { query: 42 },
            }],
            finishReason: "tool-calls",
          }),
          messages: [{ role: "user", content: "Search" }],
          tools: queryTools(),
          experimental_repairToolCall: repair as never,
        });
        error = result.toolResults?.[0]?.result;
      } else {
        const result = streamText({
          model: streamModel([
            {
              type: "tool-call",
              toolCallId: "stream-oversized-repair",
              toolName: "search",
              input: { query: 42 },
            },
            { type: "finish", finishReason: "tool-calls" },
          ]),
          messages: [{ role: "user", content: "Search" }],
          tools: queryTools(),
          experimental_repairToolCall: repair as never,
        });
        error = streamToolErrors(await collectAsync(result.fullStream))[0]?.error;
      }

      assertEquals(getErrorName(error), "AI_ToolInputLimitError");
    });
  }

  it("bounds repaired tool identifiers before copying them", async () => {
    const result = await generateText({
      model: directModel({
        content: [{
          type: "tool-call",
          toolCallId: "bounded-repair-id",
          toolName: "search",
          input: { query: 42 },
        }],
        finishReason: "tool-calls",
      }),
      messages: [{ role: "user", content: "Search" }],
      tools: queryTools(),
      experimental_repairToolCall: (context) => ({
        ...context.toolCall,
        toolCallId: "x".repeat(1_025),
      }),
    });
    const error = result.toolResults?.[0]?.result as Error | undefined;
    assertEquals(getErrorName(error), "AI_ToolCallRepairError");
    assertEquals(
      (error?.cause as Error | undefined)?.message.includes(
        "identifiers no longer than",
      ),
      true,
    );
  });

  it("limits direct generation to 128 distinct tool calls with one correlated error", async () => {
    const content = Array.from({ length: MAX_TOOL_CALLS + 1 }, (_, index) => ({
      type: "tool-call",
      toolCallId: `direct-count-${index}`,
      toolName: "search",
      input: "{}",
    }));

    const result = await generateText({
      model: directModel({ content, finishReason: "tool-calls" }),
      messages: [{ role: "user", content: "Search" }],
      tools: permissiveTools(),
    });

    assertEquals(result.toolCalls?.length, MAX_TOOL_CALLS);
    assertEquals(result.toolResults?.length, 1);
    assertEquals(result.toolResults?.[0]?.toolCallId, "direct-count-128");
    assertEquals(
      getErrorName(result.toolResults?.[0]?.result),
      "AI_ToolInputLimitError",
    );
  });

  it("rejects a direct tool input larger than 1 MiB with one correlated error", async () => {
    const oversizedInput = exactByteJsonInput(MAX_TOOL_INPUT_BYTES + 1);

    const result = await generateText({
      model: directModel({
        content: [{
          type: "tool-call",
          toolCallId: "direct-oversized",
          toolName: "search",
          input: oversizedInput,
        }],
        finishReason: "tool-calls",
      }),
      messages: [{ role: "user", content: "Search" }],
      tools: permissiveTools(),
    });

    assertEquals(result.toolCalls?.length ?? 0, 0);
    assertEquals(result.toolResults?.length, 1);
    assertEquals(result.toolResults?.[0]?.toolCallId, "direct-oversized");
    assertEquals(
      getErrorName(result.toolResults?.[0]?.result),
      "AI_ToolInputLimitError",
    );
  });

  it("caps aggregate direct tool input at 8 MiB", async () => {
    const input = exactByteJsonInput(1_048_000);
    assertEquals(8 * input.length < MAX_AGGREGATE_TOOL_INPUT_BYTES, true);
    assertEquals(9 * input.length > MAX_AGGREGATE_TOOL_INPUT_BYTES, true);
    let lateInputInspectionCount = 0;
    const uninspectedLateInput = new Proxy({ query: "must-not-inspect" }, {
      getPrototypeOf(target) {
        lateInputInspectionCount++;
        return Reflect.getPrototypeOf(target);
      },
      ownKeys(target) {
        lateInputInspectionCount++;
        return Reflect.ownKeys(target);
      },
      getOwnPropertyDescriptor(target, key) {
        lateInputInspectionCount++;
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });
    const content = [
      ...Array.from({ length: 9 }, (_, index) => ({
        type: "tool-call",
        toolCallId: `direct-aggregate-${index}`,
        toolName: "search",
        input,
      })),
      {
        type: "tool-call",
        toolCallId: "direct-aggregate-uninspected",
        toolName: "search",
        input: uninspectedLateInput,
      },
    ];

    const result = await generateText({
      model: directModel({ content, finishReason: "tool-calls" }),
      messages: [{ role: "user", content: "Search" }],
      tools: permissiveTools(),
    });

    assertEquals(result.toolCalls?.length, 8);
    assertEquals(result.toolResults?.length, 1);
    assertEquals(result.toolResults?.[0]?.toolCallId, "direct-aggregate-8");
    assertEquals(
      getErrorName(result.toolResults?.[0]?.result),
      "AI_ToolInputLimitError",
    );
    assertEquals(lateInputInspectionCount, 0);
  });

  it("accounts for the final validator-transformed size in the direct aggregate budget", async () => {
    const emptyEncoding = JSON.stringify({ payload: "" });
    const transformed = {
      payload: "x".repeat(1_048_000 - emptyEncoding.length),
    };
    assertEquals(
      new TextEncoder().encode(JSON.stringify(transformed)).byteLength,
      1_048_000,
    );
    const tools = {
      search: {
        description: "Search",
        inputSchema: {
          jsonSchema: { type: "object" },
          validate() {
            return { success: true as const, value: transformed };
          },
        },
      },
    };
    const content = Array.from({ length: 9 }, (_, index) => ({
      type: "tool-call",
      toolCallId: `direct-transformed-aggregate-${index}`,
      toolName: "search",
      input: {},
    }));

    const result = await generateText({
      model: directModel({ content, finishReason: "tool-calls" }),
      messages: [{ role: "user", content: "Search" }],
      tools,
    });

    assertEquals(result.toolCalls?.length, 8);
    assertEquals(result.toolResults?.length, 1);
    assertEquals(
      result.toolResults?.[0]?.toolCallId,
      "direct-transformed-aggregate-8",
    );
    assertEquals(
      getErrorName(result.toolResults?.[0]?.result),
      "AI_ToolInputLimitError",
    );
  });

  it("caps aggregate complete tool-call inputs in a stream at 8 MiB", async () => {
    const input = exactByteJsonInput(1_048_000);
    const calls = Array.from({ length: 9 }, (_, index) => ({
      type: "tool-call",
      toolCallId: `stream-aggregate-${index}`,
      toolName: "search",
      input,
    }));
    const result = streamText({
      model: streamModel([
        ...calls,
        { type: "finish", finishReason: "tool-calls" },
      ]),
      messages: [{ role: "user", content: "Search" }],
      tools: permissiveTools(),
    });

    const parts = await collectAsync(result.fullStream);
    const accepted = parts.filter((part) =>
      part && typeof part === "object" && "type" in part &&
      part.type === "tool-call"
    );
    const errors = streamToolErrors(parts);

    assertEquals(accepted.length, 8);
    assertEquals(errors.length, 1);
    assertEquals(errors[0]?.toolCallId, "stream-aggregate-8");
    assertEquals(getErrorName(errors[0]?.error), "AI_ToolInputLimitError");
  });

  it("does not let one oversized complete stream call poison a later valid call", async () => {
    const result = streamText({
      model: streamModel([
        {
          type: "tool-call",
          toolCallId: "stream-oversized-first",
          toolName: "search",
          input: exactByteJsonInput(MAX_TOOL_INPUT_BYTES + 1),
        },
        {
          type: "tool-call",
          toolCallId: "stream-small-after-oversized",
          toolName: "search",
          input: "{}",
        },
        { type: "finish", finishReason: "tool-calls" },
      ]),
      messages: [{ role: "user", content: "Search" }],
      tools: permissiveTools(),
    });
    const parts = await collectAsync(result.fullStream);
    const accepted = parts.filter((part) =>
      part && typeof part === "object" && "type" in part &&
      part.type === "tool-call"
    ) as Array<{ toolCallId?: unknown }>;
    const errors = streamToolErrors(parts);

    assertEquals(accepted.map(({ toolCallId }) => toolCallId), [
      "stream-small-after-oversized",
    ]);
    assertEquals(errors.length, 1);
    assertEquals(errors[0]?.toolCallId, "stream-oversized-first");
  });

  it("releases a delta-count-rejected stream reservation before later calls", async () => {
    const largeInput = exactByteJsonInput(1_048_000);
    const deltas = Array.from({ length: 4_097 }, () => ({
      type: "tool-input-delta",
      id: "stream-delta-count-rejected",
      delta: "xx",
    }));
    const laterCalls = Array.from({ length: 8 }, (_, index) => ({
      type: "tool-call",
      toolCallId: `stream-after-delta-count-${index}`,
      toolName: "search",
      input: largeInput,
    }));
    const result = streamText({
      model: streamModel([
        {
          type: "tool-input-start",
          id: "stream-delta-count-rejected",
          toolName: "search",
        },
        ...deltas,
        ...laterCalls,
        { type: "finish", finishReason: "tool-calls" },
      ]),
      messages: [{ role: "user", content: "Search" }],
      tools: permissiveTools(),
    });
    const parts = await collectAsync(result.fullStream);
    const accepted = parts.filter((part) =>
      part && typeof part === "object" && "type" in part &&
      part.type === "tool-call"
    );
    const errors = streamToolErrors(parts);

    assertEquals(accepted.length, 8);
    assertEquals(errors.length, 1);
    assertEquals(errors[0]?.toolCallId, "stream-delta-count-rejected");
  });

  it("releases a byte-limit-rejected stream reservation before later calls", async () => {
    const largeInput = exactByteJsonInput(1_048_000);
    const laterCalls = Array.from({ length: 8 }, (_, index) => ({
      type: "tool-call",
      toolCallId: `stream-after-byte-limit-${index}`,
      toolName: "search",
      input: largeInput,
    }));
    const result = streamText({
      model: streamModel([
        {
          type: "tool-input-start",
          id: "stream-byte-limit-rejected",
          toolName: "search",
        },
        {
          type: "tool-input-delta",
          id: "stream-byte-limit-rejected",
          delta: largeInput,
        },
        {
          type: "tool-input-delta",
          id: "stream-byte-limit-rejected",
          delta: "x".repeat(1_000),
        },
        ...laterCalls,
        { type: "finish", finishReason: "tool-calls" },
      ]),
      messages: [{ role: "user", content: "Search" }],
      tools: permissiveTools(),
    });
    const parts = await collectAsync(result.fullStream);
    const accepted = parts.filter((part) =>
      part && typeof part === "object" && "type" in part &&
      part.type === "tool-call"
    );
    const errors = streamToolErrors(parts);

    assertEquals(accepted.length, 8);
    assertEquals(errors.length, 1);
    assertEquals(errors[0]?.toolCallId, "stream-byte-limit-rejected");
  });

  it("releases pending bytes when a validator transformation exceeds the per-call limit", async () => {
    const largeInput = exactByteJsonInput(1_048_000);
    const oversized = exactByteJsonInput(MAX_TOOL_INPUT_BYTES + 1);
    let validationCalls = 0;
    const tools = {
      search: {
        description: "Search",
        inputSchema: {
          jsonSchema: { type: "object" },
          validate(value: unknown) {
            validationCalls++;
            return validationCalls === 1
              ? { success: true as const, value: oversized }
              : { success: true as const, value };
          },
        },
      },
    };
    const laterCalls = Array.from({ length: 8 }, (_, index) => ({
      type: "tool-call",
      toolCallId: `stream-after-transformed-limit-${index}`,
      toolName: "search",
      input: largeInput,
    }));
    const result = streamText({
      model: streamModel([
        {
          type: "tool-input-start",
          id: "stream-transformed-limit",
          toolName: "search",
        },
        {
          type: "tool-input-delta",
          id: "stream-transformed-limit",
          delta: largeInput,
        },
        { type: "tool-input-end", id: "stream-transformed-limit" },
        ...laterCalls,
        { type: "finish", finishReason: "tool-calls" },
      ]),
      messages: [{ role: "user", content: "Search" }],
      tools,
    });
    const parts = await collectAsync(result.fullStream);
    const accepted = parts.filter((part) =>
      part && typeof part === "object" && "type" in part &&
      part.type === "tool-call"
    );
    const errors = streamToolErrors(parts);

    assertEquals(accepted.length, 8);
    assertEquals(errors.length, 1);
    assertEquals(errors[0]?.toolCallId, "stream-transformed-limit");
  });

  it("releases accumulated bytes when a complete replacement is oversized", async () => {
    const largeInput = exactByteJsonInput(1_048_000);
    const laterCalls = Array.from({ length: 8 }, (_, index) => ({
      type: "tool-call",
      toolCallId: `stream-after-oversized-replacement-${index}`,
      toolName: "search",
      input: largeInput,
    }));
    const result = streamText({
      model: streamModel([
        {
          type: "tool-input-start",
          id: "stream-oversized-replacement",
          toolName: "search",
        },
        {
          type: "tool-input-delta",
          id: "stream-oversized-replacement",
          delta: largeInput,
        },
        {
          type: "tool-call",
          toolCallId: "stream-oversized-replacement",
          toolName: "search",
          input: exactByteJsonInput(MAX_TOOL_INPUT_BYTES + 1),
        },
        ...laterCalls,
        { type: "finish", finishReason: "tool-calls" },
      ]),
      messages: [{ role: "user", content: "Search" }],
      tools: permissiveTools(),
    });
    const parts = await collectAsync(result.fullStream);
    const accepted = parts.filter((part) =>
      part && typeof part === "object" && "type" in part &&
      part.type === "tool-call"
    );
    const errors = streamToolErrors(parts);

    assertEquals(accepted.length, 8);
    assertEquals(errors.length, 1);
    assertEquals(errors[0]?.toolCallId, "stream-oversized-replacement");
  });

  it("caps aggregate pending tool-input deltas before they can accumulate beyond 8 MiB", async () => {
    const input = exactByteJsonInput(1_048_000);
    const lifecycle = Array.from({ length: 9 }, (_, index) => [
      {
        type: "tool-input-start",
        id: `pending-aggregate-${index}`,
        toolName: "search",
      },
      {
        type: "tool-input-delta",
        id: `pending-aggregate-${index}`,
        delta: input,
      },
    ]).flat();
    const result = streamText({
      model: streamModel([
        ...lifecycle,
        { type: "finish", finishReason: "tool-calls" },
      ]),
      messages: [{ role: "user", content: "Search" }],
      tools: permissiveTools(),
    });

    const parts = await collectAsync(result.fullStream);
    const acceptedDeltas = parts.filter((part) =>
      part && typeof part === "object" && "type" in part &&
      part.type === "tool-input-delta"
    );
    const errors = streamToolErrors(parts);

    assertEquals(acceptedDeltas.length, 8);
    assertEquals(errors.length, 1);
    assertEquals(errors[0]?.toolCallId, "pending-aggregate-8");
    assertEquals(getErrorName(errors[0]?.error), "AI_ToolInputLimitError");
  });
});

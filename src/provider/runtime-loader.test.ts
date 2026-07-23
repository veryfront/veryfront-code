import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { assertGreaterOrEqual } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createWarningCollector,
  readProviderOptions,
  readRecord,
  type RuntimePromptMessage,
  type RuntimeToolDefinition,
  stringifyJsonValue,
  toOpenAICompatibleMessages,
  toOpenAICompatibleTools,
  withToolInputStatusTransitions,
} from "./runtime-loader.ts";
import { createOpenAIModelRuntime } from "../../extensions/ext-llm-openai/src/openai-provider.ts";
import {
  collectDueToolStatuses,
  getToolCallIdFromStreamPart,
} from "./runtime-loader/tool-input-status.ts";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T = void>(description: string, timeoutMs = 1_000): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`Timed out waiting for ${description}`));
    }, timeoutMs);
    resolve = (value) => {
      clearTimeout(timeoutId);
      resolvePromise(value);
    };
  });

  return { promise, resolve };
}

async function collectAsync<T>(
  iterable: AsyncIterable<T>,
  onValue?: (value: T, values: T[]) => void,
): Promise<T[]> {
  const values: T[] = [];
  for await (const value of iterable) {
    values.push(value);
    onValue?.(value, values);
  }
  return values;
}

function isToolStatusEvent(
  event: unknown,
  status: "pending_input" | "streaming_input",
): event is { type: "data-tool-call-status"; data: { toolCallId: string; status: string } } {
  return (
    !!event &&
    typeof event === "object" &&
    (event as { type?: string }).type === "data-tool-call-status" &&
    (event as { data?: { status?: string } }).data?.status === status
  );
}

function readRequestBody(init: RequestInit | undefined): string | null {
  if (!init || !("body" in init) || typeof init.body !== "string") {
    return null;
  }
  return init.body;
}

describe("provider/runtime-loader", () => {
  it("drains warning collectors exactly once", () => {
    const warnings = createWarningCollector();
    warnings.push({ type: "other", provider: "openai", details: "test warning" });

    assertEquals(warnings.drain(), [{
      type: "other",
      provider: "openai",
      details: "test warning",
    }]);
    assertEquals(warnings.drain(), []);
  });

  it("serializes undefined JSON values as null", () => {
    assertEquals(stringifyJsonValue(undefined), "null");
  });

  it("fails safely when a tool value is not JSON serializable", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const error = assertThrows(
      () => stringifyJsonValue(cyclic),
      TypeError,
      "JSON serializable",
    );

    assertEquals(error.message.includes("self"), false);
  });

  it("preserves explicit image parts even when the media type is generic", () => {
    assertEquals(
      toOpenAICompatibleMessages([{
        role: "user",
        content: [{
          type: "image",
          mediaType: "application/octet-stream",
          url: "data:image/png;base64,AA==",
        }],
      }]),
      [{
        role: "user",
        content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AA==" } }],
      }],
    );
  });

  it("rejects unsafe image URLs before building provider messages", () => {
    assertThrows(
      () =>
        toOpenAICompatibleMessages([{
          role: "user",
          content: [{ type: "image", mediaType: "image/png", url: "file:///private/image.png" }],
        }]),
      TypeError,
      "image URL",
    );
  });

  it("enforces the text bound when a user message also contains an image", () => {
    assertThrows(
      () =>
        toOpenAICompatibleMessages([{
          role: "user",
          content: [
            { type: "text", text: "x".repeat(8 * 1_024 * 1_024 + 1) },
            { type: "image", mediaType: "image/png", url: "data:image/png;base64,AA==" },
          ],
        }]),
      RangeError,
      "text exceeded",
    );
  });

  it("rejects malformed and oversized prompt message content", () => {
    assertThrows(
      () =>
        toOpenAICompatibleMessages([{
          role: "system",
          content: "x".repeat(8 * 1_024 * 1_024 + 1),
        }]),
      RangeError,
      "text exceeded",
    );
    assertThrows(
      () =>
        toOpenAICompatibleMessages([{
          role: "unsupported",
          content: "ignored",
        } as never]),
      TypeError,
      "invalid role",
    );
  });

  it("rejects empty prompts and unsupported non-image file parts", () => {
    assertThrows(
      () => toOpenAICompatibleMessages([]),
      RangeError,
      "at least one message",
    );
    assertThrows(
      () =>
        toOpenAICompatibleMessages([{
          role: "user",
          content: [{
            type: "file",
            mediaType: "application/pdf",
            url: "https://example.test/report.pdf",
          }],
        }]),
      TypeError,
      "non-image file",
    );
  });

  it("does not invoke prompt or tool metadata accessors", () => {
    let messageAccessorInvoked = false;
    const message = Object.defineProperty({}, "role", {
      enumerable: true,
      get() {
        messageAccessorInvoked = true;
        throw new Error("private prompt metadata");
      },
    });
    assertThrows(
      () => toOpenAICompatibleMessages([message as RuntimePromptMessage]),
      TypeError,
      "invalid role",
    );
    assertEquals(messageAccessorInvoked, false);

    let toolAccessorInvoked = false;
    const tool = Object.defineProperty({}, "type", {
      enumerable: true,
      get() {
        toolAccessorInvoked = true;
        throw new Error("private tool metadata");
      },
    });
    assertThrows(
      () => toOpenAICompatibleTools([tool as RuntimeToolDefinition]),
      TypeError,
      "tool definition",
    );
    assertEquals(toolAccessorInvoked, false);
  });

  it("rejects unsafe control characters in provider tool identifiers", () => {
    assertThrows(
      () =>
        toOpenAICompatibleTools([{
          type: "function",
          name: "unsafe\nname",
          inputSchema: {},
        }]),
      TypeError,
      "tool name",
    );
    assertThrows(
      () =>
        toOpenAICompatibleMessages([{
          role: "assistant",
          content: [{
            type: "tool-call",
            toolCallId: "unsafe\nid",
            toolName: "lookup",
            input: {},
          }],
        }]),
      TypeError,
      "tool call ID",
    );
  });

  it("bounds aggregate prompt content across messages", () => {
    const largePart = "x".repeat(3 * 1_024 * 1_024);

    assertThrows(
      () =>
        toOpenAICompatibleMessages([
          { role: "system", content: largePart },
          { role: "system", content: largePart },
          { role: "system", content: largePart },
        ]),
      RangeError,
      "prompt exceeded",
    );
  });

  it("rejects malformed prompt parts with a stable boundary error", () => {
    assertThrows(
      () =>
        toOpenAICompatibleMessages([{
          role: "user",
          content: [{ type: "image", url: "https://example.com/image.png" }],
        }] as never),
      TypeError,
      "content part",
    );
  });

  it("bounds OpenAI-compatible tool definitions", () => {
    const tools = Array.from({ length: 129 }, (_, index) => ({
      type: "function" as const,
      name: `tool_${index}`,
      inputSchema: { type: "object" },
    }));

    assertThrows(
      () => toOpenAICompatibleTools(tools),
      RangeError,
      "at most 128 tools",
    );
  });

  it("merges provider options without changing the result prototype", () => {
    const polluted = JSON.parse('{"__proto__":{"compromised":true},"value":1}') as Record<
      string,
      unknown
    >;
    const merged = readProviderOptions({ provider: polluted }, "provider");

    assertEquals(Object.getPrototypeOf(merged), Object.prototype);
    assertEquals((merged as { compromised?: unknown }).compromised, undefined);
    assertEquals(Object.hasOwn(merged, "__proto__"), true);
    assertEquals(merged.value, 1);
  });

  it("does not invoke accessors while reading provider records", () => {
    let invoked = false;
    const value = Object.defineProperty({ safe: 1 }, "secret", {
      enumerable: true,
      get() {
        invoked = true;
        throw new Error("private getter value");
      },
    });

    assertEquals(readRecord(value), { safe: 1 });
    assertEquals(invoked, false);
  });

  it("does not invoke accessors while selecting provider option records", () => {
    let invoked = false;
    const options = Object.defineProperty({}, "provider", {
      enumerable: true,
      get() {
        invoked = true;
        throw new Error("private provider options");
      },
    });

    assertEquals(readProviderOptions(options, "provider"), {});
    assertEquals(invoked, false);
  });

  it("emits pending_input and streaming_input transitions when tool input goes silent and resumes", async () => {
    const pendingAfterStart = deferred("pending_input after tool-input-start");
    const pendingAfterDelta = deferred("pending_input after tool-input-delta");
    let pendingCount = 0;

    const events = await collectAsync(
      withToolInputStatusTransitions({
        async *[Symbol.asyncIterator]() {
          yield { type: "tool-input-start", id: "tool-1", toolName: "create_file" };
          await pendingAfterStart.promise;
          yield { type: "tool-input-delta", id: "tool-1", delta: '{"path":"docs/report.md"' };
          await pendingAfterDelta.promise;
          yield {
            type: "tool-call",
            toolCallId: "tool-1",
            toolName: "create_file",
            input: { path: "docs/report.md" },
          };
          yield { type: "finish", finishReason: "tool-calls" };
        },
      }, 1),
      (event) => {
        if (isToolStatusEvent(event, "pending_input")) {
          pendingCount += 1;
          if (pendingCount === 1) {
            pendingAfterStart.resolve();
          } else if (pendingCount === 2) {
            pendingAfterDelta.resolve();
          }
        }
      },
    );

    assertEquals(events, [
      { type: "tool-input-start", id: "tool-1", toolName: "create_file" },
      {
        type: "data-tool-call-status",
        data: { toolCallId: "tool-1", status: "pending_input" },
      },
      {
        type: "data-tool-call-status",
        data: { toolCallId: "tool-1", status: "streaming_input" },
      },
      { type: "tool-input-delta", id: "tool-1", delta: '{"path":"docs/report.md"' },
      {
        type: "data-tool-call-status",
        data: { toolCallId: "tool-1", status: "pending_input" },
      },
      {
        type: "tool-call",
        toolCallId: "tool-1",
        toolName: "create_file",
        input: { path: "docs/report.md" },
      },
      { type: "finish", finishReason: "tool-calls" },
    ]);
  });

  it("repeats pending_input heartbeats while create_file content stays silent after the path", async () => {
    const repeatedPendingAfterPath = deferred("repeated pending_input after the path delta");
    let pendingAfterPathCount = 0;
    let sawPathDelta = false;

    const events = await collectAsync(
      withToolInputStatusTransitions({
        async *[Symbol.asyncIterator]() {
          yield { type: "tool-input-start", id: "tool-1", toolName: "create_file" };
          yield {
            type: "tool-input-delta",
            id: "tool-1",
            delta: '{"path":"plans/ai-ontologies-research.md"',
          };
          await repeatedPendingAfterPath.promise;
          yield { type: "tool-input-delta", id: "tool-1", delta: ', "content":"# AI Ontologies"' };
          yield {
            type: "tool-call",
            toolCallId: "tool-1",
            toolName: "create_file",
            input: {
              path: "plans/ai-ontologies-research.md",
              content: "# AI Ontologies",
            },
          };
          yield { type: "finish", finishReason: "tool-calls" };
        },
      }, 1),
      (event) => {
        if (
          event &&
          typeof event === "object" &&
          (event as { type?: string }).type === "tool-input-delta"
        ) {
          sawPathDelta = true;
          return;
        }

        if (sawPathDelta && isToolStatusEvent(event, "pending_input")) {
          pendingAfterPathCount += 1;
          if (pendingAfterPathCount === 2) {
            repeatedPendingAfterPath.resolve();
          }
        }
      },
    );

    const firstDeltaIndex = events.findIndex((event) =>
      event && typeof event === "object" && (event as { type?: string }).type === "tool-input-delta"
    );
    const secondDeltaIndex = events.findIndex((event, index) =>
      index > firstDeltaIndex &&
      event &&
      typeof event === "object" &&
      (event as { type?: string }).type === "tool-input-delta"
    );

    const pendingBetweenDeltas = events
      .slice(firstDeltaIndex + 1, secondDeltaIndex)
      .filter((event) =>
        event &&
        typeof event === "object" &&
        (event as { type?: string }).type === "data-tool-call-status" &&
        (event as { data?: { status?: string } }).data?.status === "pending_input"
      );

    assertGreaterOrEqual(
      pendingBetweenDeltas.length,
      2,
      "expected repeated pending_input heartbeats while create_file content stayed silent",
    );

    assertEquals(events[0], { type: "tool-input-start", id: "tool-1", toolName: "create_file" });
    assertEquals(events[1], {
      type: "data-tool-call-status",
      data: { toolCallId: "tool-1", status: "streaming_input" },
    });
    assertEquals(events[firstDeltaIndex], {
      type: "tool-input-delta",
      id: "tool-1",
      delta: '{"path":"plans/ai-ontologies-research.md"',
    });
    assertEquals(events[secondDeltaIndex - 1], {
      type: "data-tool-call-status",
      data: { toolCallId: "tool-1", status: "streaming_input" },
    });
    assertEquals(events[secondDeltaIndex], {
      type: "tool-input-delta",
      id: "tool-1",
      delta: ', "content":"# AI Ontologies"',
    });
  });

  it("closes the upstream iterator when the consumer stops early", async () => {
    let returned = false;
    const stream: AsyncIterable<unknown> = {
      [Symbol.asyncIterator]() {
        let emitted = false;
        return {
          next() {
            if (!emitted) {
              emitted = true;
              return Promise.resolve({ done: false as const, value: { type: "text-delta" } });
            }
            return new Promise<IteratorResult<unknown>>(() => {});
          },
          return() {
            returned = true;
            return Promise.resolve({ done: true as const, value: undefined });
          },
        };
      },
    };

    for await (const _part of withToolInputStatusTransitions(stream)) {
      break;
    }

    assertEquals(returned, true);
  });

  it("bounds tool status identifiers and pending status batches", () => {
    assertEquals(
      getToolCallIdFromStreamPart({ id: "x".repeat(1_025) }),
      null,
    );
    assertEquals(
      getToolCallIdFromStreamPart({ toolCallId: "unsafe\nidentifier" }),
      null,
    );

    const states = new Map(
      Array.from({ length: 129 }, (_, index) =>
        [
          `tool-${index}`,
          { dueAt: 0, lastStatus: null },
        ] as const),
    );
    assertEquals(collectDueToolStatuses(states, 1, 5).length, 128);
  });

  it("forwards stream parts with unreadable type metadata unchanged", async () => {
    const hostilePart = new Proxy({}, {
      get(target, property, receiver) {
        if (property === "type") {
          throw new Error("unreadable provider stream metadata");
        }
        return Reflect.get(target, property, receiver);
      },
    });

    let emitted = false;
    const events = await collectAsync(
      withToolInputStatusTransitions({
        [Symbol.asyncIterator]() {
          return {
            next() {
              if (emitted) {
                return Promise.resolve({ done: true as const, value: undefined });
              }
              emitted = true;
              return Promise.resolve({ done: false as const, value: hostilePart });
            },
          };
        },
      }),
    );

    assertEquals(events.length, 1);
    assertEquals(events[0] === hostilePart, true);
  });

  describe("provider warnings (unsupported-setting drops)", () => {
    const userPrompt = {
      role: "user",
      content: [{ type: "text", text: "Hi" }],
    } as const;

    function okOpenAIResponse() {
      return new Response(
        JSON.stringify({
          choices: [{
            index: 0,
            message: { role: "assistant", content: "ok" },
            finish_reason: "stop",
          }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    it("omits provider metadata fields when userId is unset", async () => {
      let openaiBody: Record<string, unknown> | null = null;

      const openai = createOpenAIModelRuntime({
        apiKey: "k",
        baseURL: "https://example.openai.test/v1",
        fetch: (_input, init) => {
          const raw = readRequestBody(init);
          openaiBody = raw ? JSON.parse(raw) : null;
          return Promise.resolve(okOpenAIResponse());
        },
      }, "gpt-4o-mini");

      await openai.doGenerate({ prompt: [userPrompt] });

      assertEquals("user" in (openaiBody ?? {}), false);
    });
  });
});

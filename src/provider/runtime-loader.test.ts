import "#veryfront/schemas/_test-setup.ts";
import { fromError } from "#veryfront/errors";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { assertGreaterOrEqual } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { MAX_TIMER_DELAY_MS } from "#veryfront/utils/timer.ts";
import { toOpenAICompatibleMessages, withToolInputStatusTransitions } from "./runtime-loader.ts";
import { createOpenAIModelRuntime } from "../../extensions/ext-llm-openai/src/openai-provider.ts";

function captureThrownError(
  fn: () => unknown,
  expectedType?: typeof Error,
  messageIncludes?: string,
): Error {
  try {
    fn();
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    const actualName = error.name;
    if (expectedType && !(error instanceof expectedType)) {
      throw new Error(`Expected ${expectedType.name}, received ${actualName}`);
    }
    if (messageIncludes && !error.message.includes(messageIncludes)) {
      throw new Error(`Expected error message to include ${messageIncludes}`);
    }
    return error;
  }
  throw new Error("Expected function to throw");
}

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

async function waitWithin<T>(
  promise: Promise<T>,
  description: string,
  timeoutMs = 500,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(`Timed out waiting for ${description}`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
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
  it("merges adjacent system layers for OpenAI-compatible providers", () => {
    assertEquals(
      toOpenAICompatibleMessages([{
        role: "system",
        content: "You are a helpful local assistant.",
      }, {
        role: "system",
        content: "<runtime_context>current_date_utc: 2026-08-20</runtime_context>",
      }, {
        role: "user",
        content: [{ type: "text", text: "Hello" }],
      }]),
      [{
        role: "system",
        content:
          "You are a helpful local assistant.\n\n<runtime_context>current_date_utc: 2026-08-20</runtime_context>",
      }, {
        role: "user",
        content: "Hello",
      }],
    );
  });

  it("omits empty system layers without adding blank separators", () => {
    assertEquals(
      toOpenAICompatibleMessages([{
        role: "system",
        content: "Base instructions",
      }, {
        role: "system",
        content: "",
      }, {
        role: "system",
        content: "Runtime context",
      }]),
      [{
        role: "system",
        content: "Base instructions\n\nRuntime context",
      }],
    );
  });

  it("does not merge system messages across conversation roles", () => {
    assertEquals(
      toOpenAICompatibleMessages([{
        role: "system",
        content: "Initial instructions",
      }, {
        role: "user",
        content: [{ type: "text", text: "Hello" }],
      }, {
        role: "system",
        content: "Follow-up instructions",
      }]),
      [{
        role: "system",
        content: "Initial instructions",
      }, {
        role: "user",
        content: "Hello",
      }, {
        role: "system",
        content: "Follow-up instructions",
      }],
    );
  });

  it("serializes tool-call arguments as JSON objects without changing string tool results", () => {
    assertEquals(
      toOpenAICompatibleMessages([{
        role: "assistant",
        content: [{
          type: "tool-call",
          toolCallId: "tool-1",
          toolName: "lookup",
          input: { query: "Veryfront" },
        }],
      }, {
        role: "tool",
        content: [{
          type: "tool-result",
          toolCallId: "tool-1",
          toolName: "lookup",
          output: { type: "json", value: "plain result" },
        }],
      }]),
      [{
        role: "assistant",
        content: null,
        tool_calls: [{
          id: "tool-1",
          type: "function",
          function: { name: "lookup", arguments: '{"query":"Veryfront"}' },
        }],
      }, {
        role: "tool",
        tool_call_id: "tool-1",
        content: "plain result",
      }],
    );
  });

  it("classifies incompatible provider-executed replay as a configuration error", () => {
    for (
      const testCase of [
        {
          part: {
            type: "tool-call" as const,
            toolCallId: "provider-call-1",
            toolName: "web_search",
            input: { query: "Veryfront" },
            providerExecuted: true as const,
          },
          subject: "calls",
        },
        {
          part: {
            type: "tool-result" as const,
            toolCallId: "provider-call-1",
            toolName: "web_search",
            result: { type: "computer_initialize_state", id: "17" },
            providerExecuted: true as const,
          },
          subject: "results",
        },
      ]
    ) {
      const message =
        `OpenAI-compatible provider-executed assistant tool ${testCase.subject} cannot be replayed through Chat Completions`;
      const error = captureThrownError(
        () =>
          toOpenAICompatibleMessages([{
            role: "assistant",
            content: [testCase.part],
          }]),
        Error,
      );

      assertEquals(error instanceof TypeError, true);
      assertEquals(error.name, "VeryfrontError[config]");
      assertEquals(fromError(error), { type: "config", message });
      assertEquals(error.message, message);
    }
  });

  it("preserves OpenAI-compatible tool argument text and serializes structured inputs", () => {
    assertEquals(
      toOpenAICompatibleMessages([{
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "call-text",
            toolName: "lookup",
            input: '{"id":"text"}',
          },
          {
            type: "tool-call",
            toolCallId: "call-object",
            toolName: "lookup",
            input: { id: "object" },
          },
        ],
      }]),
      [{
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call-text",
            type: "function",
            function: { name: "lookup", arguments: '{"id":"text"}' },
          },
          {
            id: "call-object",
            type: "function",
            function: { name: "lookup", arguments: '{"id":"object"}' },
          },
        ],
      }],
    );
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

  it("closes the source iterator when the status-transition consumer returns", async () => {
    let sourceClosed = false;
    const source = async function* () {
      try {
        yield { type: "text-delta", delta: "first" };
        await new Promise(() => {});
      } finally {
        sourceClosed = true;
      }
    };
    const iterator = withToolInputStatusTransitions(source())[Symbol.asyncIterator]();

    assertEquals(await iterator.next(), {
      done: false,
      value: { type: "text-delta", delta: "first" },
    });
    assertEquals(await iterator.return?.(), { done: true, value: undefined });
    assertEquals(sourceClosed, true);
  });

  it("does not wait for hostile idle source cleanup on consumer return", async () => {
    let returnCalls = 0;
    const source: AsyncIterable<unknown> = {
      [Symbol.asyncIterator]() {
        return {
          next() {
            return Promise.resolve({
              done: false as const,
              value: { type: "text-delta", delta: "first" },
            });
          },
          return() {
            returnCalls++;
            return new Promise<IteratorResult<unknown>>(() => {});
          },
        };
      },
    };
    const iterator = withToolInputStatusTransitions(source)[Symbol.asyncIterator]();

    assertEquals(await iterator.next(), {
      done: false,
      value: { type: "text-delta", delta: "first" },
    });
    assertEquals(
      await waitWithin(
        iterator.return?.() ?? Promise.resolve({
          done: true,
          value: undefined,
        }),
        "hostile idle source cleanup",
      ),
      { done: true, value: undefined },
    );
    assertEquals(returnCalls, 1);
  });

  it("does not let hostile cleanup hide a source read failure", async () => {
    const sourceFailure = new Error("provider read failed");
    let returnCalls = 0;
    const source: AsyncIterable<unknown> = {
      [Symbol.asyncIterator]() {
        return {
          next() {
            return Promise.reject(sourceFailure);
          },
          return() {
            returnCalls++;
            return new Promise<IteratorResult<unknown>>(() => {});
          },
        };
      },
    };
    const iterator = withToolInputStatusTransitions(source)[Symbol.asyncIterator]();

    const error = await assertRejects(() => waitWithin(iterator.next(), "source read failure"));
    assertEquals(error, sourceFailure);
    assertEquals(returnCalls, 1);
  });

  it("closes the source iterator while its next call is pending", async () => {
    const pendingReadStarted = deferred("pending source read");
    const sourceReturnCalled = deferred("source return");
    let readCount = 0;

    const source: AsyncIterable<unknown> = {
      [Symbol.asyncIterator]() {
        return {
          next() {
            readCount++;
            if (readCount === 1) {
              return Promise.resolve({
                done: false as const,
                value: { type: "tool-input-start", id: "tool-1", toolName: "create_file" },
              });
            }

            pendingReadStarted.resolve();
            return new Promise<IteratorResult<unknown>>(() => {});
          },
          return() {
            sourceReturnCalled.resolve();
            return Promise.resolve({ done: true as const, value: undefined });
          },
        };
      },
    };
    const iterator = withToolInputStatusTransitions(source)[Symbol.asyncIterator]();

    assertEquals(await iterator.next(), {
      done: false,
      value: { type: "tool-input-start", id: "tool-1", toolName: "create_file" },
    });

    const pendingRead = iterator.next();
    await pendingReadStarted.promise;
    if (!iterator.return) {
      throw new Error("Expected transformed iterator to support return()");
    }
    assertEquals(
      await waitWithin(iterator.return(), "consumer return"),
      { done: true, value: undefined },
    );
    await sourceReturnCalled.promise;
    assertEquals(await waitWithin(pendingRead, "pending transformed read"), {
      done: true,
      value: undefined,
    });
  });

  it("rejects tool input thresholds outside the portable timer domain", () => {
    const source = {
      async *[Symbol.asyncIterator]() {
        yield { type: "finish", finishReason: "stop" };
      },
    };

    for (
      const thresholdMs of [
        -0.01,
        0,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        MAX_TIMER_DELAY_MS + 0.5,
      ]
    ) {
      assertThrows(
        () => withToolInputStatusTransitions(source, thresholdMs),
        RangeError,
      );
    }
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

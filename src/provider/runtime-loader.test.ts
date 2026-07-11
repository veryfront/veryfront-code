import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { assertGreaterOrEqual } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withToolInputStatusTransitions } from "./runtime-loader.ts";
import { createOpenAIModelRuntime } from "../../extensions/ext-llm-openai/src/openai-provider.ts";

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
      }, 0),
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
      }, 0),
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

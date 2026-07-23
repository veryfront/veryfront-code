import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { type ModelRuntime } from "#veryfront/provider";
import { agent } from "../index.ts";

function createRuntimeStream(parts: unknown[]) {
  return new ReadableStream<unknown>({
    start(controller) {
      for (const part of parts) controller.enqueue(part);
      controller.close();
    },
  });
}

/**
 * Read the most recent user-turn text from the model-runtime prompt. The stub
 * model echoes this back, so a contaminated (shared) conversation would surface
 * another concurrent run's input here instead of this call's own input.
 */
function lastUserText(options: unknown): string {
  const prompt = (options as { prompt?: Array<{ role?: string; content?: unknown }> }).prompt;
  if (!Array.isArray(prompt)) return "";
  for (let i = prompt.length - 1; i >= 0; i--) {
    const entry = prompt[i];
    if (entry?.role !== "user") continue;
    const content = entry.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .map((p) =>
          p && typeof p === "object" && "text" in p
            ? String((p as { text?: unknown }).text ?? "")
            : ""
        )
        .join("");
    }
    return "";
  }
  return "";
}

/** A model that echoes the latest user message verbatim. */
function echoModel(modelId: string): ModelRuntime {
  return {
    provider: "hosted",
    modelId,
    doGenerate(options: unknown) {
      return Promise.resolve({
        content: [{ type: "text", text: lastUserText(options) }],
        finishReason: "stop",
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      });
    },
    doStream(options: unknown) {
      return Promise.resolve({
        stream: createRuntimeStream([
          { type: "text-delta", text: lastUserText(options) },
          { type: "finish", finishReason: "stop", usage: { inputTokens: 1, outputTokens: 1 } },
        ]),
      });
    },
  } as ModelRuntime;
}

/** A model that records the maxOutputTokens the runtime resolved for the call. */
function capturingModel(modelId: string, captured: { maxOutputTokens?: number }): ModelRuntime {
  return {
    provider: "hosted",
    modelId,
    doGenerate(options: unknown) {
      captured.maxOutputTokens = (options as { maxOutputTokens?: number }).maxOutputTokens;
      return Promise.resolve({
        content: [{ type: "text", text: "ok" }],
        finishReason: "stop",
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      });
    },
    doStream() {
      return Promise.resolve({
        stream: createRuntimeStream([{ type: "finish", finishReason: "stop" }]),
      });
    },
  } as ModelRuntime;
}

const WORDS = ["APPLE", "BANANA", "CHERRY"];
const prompt = (word: string) => `The secret word is ${word}.`;

describe("agent memory isolation (issue 2336)", () => {
  it("isolates concurrent generate() calls on a shared default instance", async () => {
    const shared = agent({
      id: "echo-generate-concurrent",
      model: "hosted/echo-generate-concurrent",
      system: "Echo the secret word.",
      maxSteps: 1,
      resolveModelTransport: () => Promise.resolve({ model: echoModel("hosted/echo") }),
    });

    const results = await Promise.all(WORDS.map((w) => shared.generate({ input: prompt(w) })));

    assertEquals(results.map((r) => r.text), WORDS.map(prompt));
    // Stateless by default: nothing accumulates, so concurrent runs can't mix.
    assertEquals((await shared.getMemoryStats()).totalMessages, 0);
  });

  it("isolates concurrent stream() calls on a shared default instance", async () => {
    const shared = agent({
      id: "echo-stream-concurrent",
      model: "hosted/echo-stream-concurrent",
      system: "Echo the secret word.",
      maxSteps: 1,
      resolveModelTransport: () => Promise.resolve({ model: echoModel("hosted/echo") }),
    });

    const texts = await Promise.all(WORDS.map(async (w) => {
      let captured = "";
      const result = await shared.stream({
        input: prompt(w),
        maxOutputTokens: 20,
        onFinish: (r) => (captured = r.text),
      });
      await result.toDataStreamResponse().text();
      return captured;
    }));

    assertEquals(texts, WORDS.map(prompt));
    assertEquals((await shared.getMemoryStats()).totalMessages, 0);
  });

  it("memory.enabled === false keeps every call isolated and stateless", async () => {
    const isolated = agent({
      id: "echo-disabled-memory",
      model: "hosted/echo-disabled-memory",
      system: "Echo.",
      maxSteps: 1,
      memory: { type: "conversation", enabled: false },
      resolveModelTransport: () => Promise.resolve({ model: echoModel("hosted/echo") }),
    });

    await isolated.generate({ input: "first" });
    await isolated.generate({ input: "second" });

    const stats = await isolated.getMemoryStats();
    assertEquals(stats.totalMessages, 0);
    assertEquals(stats.type, "none");
  });

  it("configured memory still persists conversation across sequential calls", async () => {
    const stateful = agent({
      id: "echo-stateful-memory",
      model: "hosted/echo-stateful-memory",
      system: "Echo.",
      maxSteps: 1,
      memory: { type: "conversation" },
      resolveModelTransport: () => Promise.resolve({ model: echoModel("hosted/echo") }),
    });

    await stateful.generate({ input: "first" });
    // One single-step turn persists the user message and the assistant reply.
    assertEquals((await stateful.getMemoryStats()).totalMessages, 2);

    await stateful.generate({ input: "second" });
    assertEquals((await stateful.getMemoryStats()).totalMessages, 4);
  });

  it("configured mode preserves shared memory while isolated concurrent generate calls bypass it", async () => {
    const configured = agent({
      id: "echo-explicit-configured-memory",
      model: "hosted/echo-explicit-configured-memory",
      system: "Echo.",
      maxSteps: 1,
      memory: { type: "conversation" },
      resolveModelTransport: () => Promise.resolve({ model: echoModel("hosted/echo") }),
    });

    await configured.generate({ input: "configured", memoryMode: "configured" });
    assertEquals((await configured.getMemoryStats()).totalMessages, 2);

    const isolatedResults = await Promise.all(
      WORDS.map((word) =>
        configured.generate({
          input: prompt(word),
          memoryMode: "isolated",
        })
      ),
    );

    assertEquals(isolatedResults.map((result) => result.text), WORDS.map(prompt));
    assertEquals(isolatedResults.map((result) => result.messages.length), [2, 2, 2]);
    // Isolated calls neither read the configured history nor append to it.
    assertEquals((await configured.getMemoryStats()).totalMessages, 2);
  });

  it("isolates concurrent stream calls from configured shared memory", async () => {
    const configured = agent({
      id: "echo-isolated-stream-configured-memory",
      model: "hosted/echo-isolated-stream-configured-memory",
      system: "Echo.",
      maxSteps: 1,
      memory: { type: "conversation" },
      resolveModelTransport: () => Promise.resolve({ model: echoModel("hosted/echo") }),
    });

    const texts = await Promise.all(WORDS.map(async (word) => {
      let captured = "";
      const result = await configured.stream({
        input: prompt(word),
        memoryMode: "isolated",
        onFinish: (response) => (captured = response.text),
      });
      await result.toDataStreamResponse().text();
      return captured;
    }));

    assertEquals(texts, WORDS.map(prompt));
    assertEquals((await configured.getMemoryStats()).totalMessages, 0);
  });

  it("memory.enabled === false ignores leftover maxTokens for the output limit", async () => {
    // A disabled memory config must behave exactly like omitting `memory`: its
    // maxTokens (a conversation-window size) must not cap model output.
    const disabledCapture: { maxOutputTokens?: number } = {};
    const disabled = agent({
      id: "echo-disabled-maxtokens",
      model: "hosted/echo-disabled-maxtokens",
      system: "x",
      maxSteps: 1,
      memory: { type: "conversation", enabled: false, maxTokens: 100 },
      resolveModelTransport: () =>
        Promise.resolve({ model: capturingModel("hosted/cap-disabled", disabledCapture) }),
    });

    const omittedCapture: { maxOutputTokens?: number } = {};
    const omitted = agent({
      id: "echo-omitted-memory",
      model: "hosted/echo-omitted-memory",
      system: "x",
      maxSteps: 1,
      resolveModelTransport: () =>
        Promise.resolve({ model: capturingModel("hosted/cap-omitted", omittedCapture) }),
    });

    await disabled.generate({ input: "hi" });
    await omitted.generate({ input: "hi" });

    assertEquals(disabledCapture.maxOutputTokens, omittedCapture.maxOutputTokens);
    assertEquals(disabledCapture.maxOutputTokens === 100, false);
  });
});

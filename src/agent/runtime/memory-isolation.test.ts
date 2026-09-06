import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { type ModelRuntime } from "#veryfront/provider";
import { AgentRuntime } from "./index.ts";
import { registerTurnProviderRequestValidator } from "#veryfront/agent/middleware/turn-validation.ts";
import { agent } from "../index.ts";
import { type ScriptedModel, scriptedModel } from "./model-runtime.test-helpers.ts";

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
  return scriptedModel(
    [(options) => ({ text: lastUserText(options) })],
    { modelId },
  );
}

/** A model that records the maxOutputTokens the runtime resolved for the call. */
function capturingModel(modelId: string): ScriptedModel {
  return scriptedModel([{ text: "ok" }], { modelId });
}

const WORDS = ["APPLE", "BANANA", "CHERRY"];
const prompt = (word: string) => `The secret word is ${word}.`;

describe("agent memory isolation (issue 2336)", () => {
  it("keeps rejected input out of public memory while provider validation is pending", async () => {
    const validationEntered = Promise.withResolvers<void>();
    const releaseValidation = Promise.withResolvers<void>();
    const runtime = new AgentRuntime("pending-validation-isolation", {
      model: "hosted/pending-validation-isolation",
      system: "Validate before dispatch.",
      memory: { type: "conversation" },
      skills: false,
      maxSteps: 1,
      middleware: [(context, next) => {
        registerTurnProviderRequestValidator(context, async () => {
          validationEntered.resolve();
          await releaseValidation.promise;
          throw new Error("rejected pending input");
        });
        return next();
      }],
      resolveModelTransport: () =>
        Promise.resolve({
          model: {
            provider: "hosted",
            modelId: "hosted/pending-validation-isolation",
            doGenerate: () => Promise.reject(new Error("rejected input reached provider")),
            doStream: () => Promise.reject(new Error("rejected input reached provider")),
          },
        }),
    });

    const pending = runtime.generate("private pending input");
    await validationEntered.promise;
    assertEquals(await runtime.getMemory().getMessages(), []);
    releaseValidation.resolve();
    await assertRejects(() => pending, Error, "rejected pending input");
    assertEquals(await runtime.getMemory().getMessages(), []);
  });

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

  it("memory.enabled === false ignores leftover maxTokens for the output limit", async () => {
    // A disabled memory config must behave exactly like omitting `memory`: its
    // maxTokens (a conversation-window size) must not cap model output.
    const disabledModel = capturingModel("hosted/cap-disabled");
    const disabled = agent({
      id: "echo-disabled-maxtokens",
      model: "hosted/echo-disabled-maxtokens",
      system: "x",
      maxSteps: 1,
      memory: { type: "conversation", enabled: false, maxTokens: 100 },
      resolveModelTransport: () => Promise.resolve({ model: disabledModel }),
    });

    const omittedModel = capturingModel("hosted/cap-omitted");
    const omitted = agent({
      id: "echo-omitted-memory",
      model: "hosted/echo-omitted-memory",
      system: "x",
      maxSteps: 1,
      resolveModelTransport: () => Promise.resolve({ model: omittedModel }),
    });

    await disabled.generate({ input: "hi" });
    await omitted.generate({ input: "hi" });

    assertEquals(disabledModel.calls[0]?.maxOutputTokens, omittedModel.calls[0]?.maxOutputTokens);
    assertEquals(disabledModel.calls[0]?.maxOutputTokens === 100, false);
  });
});

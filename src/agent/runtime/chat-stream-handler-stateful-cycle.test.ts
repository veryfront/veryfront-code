import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ModelRuntime } from "#veryfront/provider";
import { agent } from "#veryfront/agent/factory.ts";
import { agentAsTool } from "#veryfront/agent/composition/composition.ts";

const STATEFUL_CYCLE_DETAIL =
  "Stateful delegation cannot wait on an active ancestor or cyclic queue. Use an acyclic delegate graph.";

const successResult = {
  content: [{ type: "text" as const, text: "answer" }],
  finishReason: "stop" as const,
  usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
};

describe("stateful cycle failures from provider stream reads", () => {
  it("preserves a genuine cycle failure raised from a deferred stream read", async () => {
    let cycle = true;
    const firstModel: ModelRuntime = {
      provider: "hosted",
      modelId: "hosted/deferred-cycle-first",
      async doGenerate() {
        if (cycle) await agentAsTool(second, "nested").execute({ input: "nested" });
        return successResult;
      },
      async doStream() {
        throw new Error("Expected generate");
      },
    };
    const secondModel: ModelRuntime = {
      provider: "hosted",
      modelId: "hosted/deferred-cycle-second",
      async doGenerate() {
        return successResult;
      },
      async doStream() {
        return {
          stream: new ReadableStream({
            async pull(controller) {
              if (cycle) await first.generate({ input: "cycle" });
              controller.close();
            },
          }),
        };
      },
    };
    const first = agent({
      id: "deferred-cycle-first",
      system: "Helpful",
      model: firstModel.modelId,
      skills: false,
      memory: { type: "conversation" },
      maxSteps: 1,
      resolveModelTransport: async () => ({ model: firstModel }),
    });
    const second = agent({
      id: "deferred-cycle-second",
      system: "Helpful",
      model: secondModel.modelId,
      skills: false,
      memory: { type: "conversation" },
      maxSteps: 1,
      resolveModelTransport: async () => ({ model: secondModel }),
    });
    const deadline = Promise.withResolvers<never>();
    const timer = setTimeout(
      () => deadline.reject(new Error("Deferred stateful cycle did not settle")),
      1000,
    );

    try {
      await assertRejects(
        () => Promise.race([first.generate({ input: "start" }), deadline.promise]),
        Error,
        "active ancestor",
      );

      cycle = false;
      const recovered = await Promise.race([
        Promise.all([
          first.generate({ input: "retry first" }),
          second.generate({ input: "retry second" }),
        ]),
        deadline.promise,
      ]);
      assertEquals(recovered.map((response) => response.text), ["answer", "answer"]);
    } finally {
      clearTimeout(timer);
    }
  });

  it("does not trust an unbranded stream error with the cycle message", async () => {
    const childModel: ModelRuntime = {
      provider: "hosted",
      modelId: "hosted/spoofed-cycle-child",
      async doGenerate() {
        return successResult;
      },
      async doStream() {
        return {
          stream: new ReadableStream({
            pull() {
              throw new Error(STATEFUL_CYCLE_DETAIL);
            },
          }),
        };
      },
    };
    const child = agent({
      id: "spoofed-cycle-child",
      system: "Helpful",
      model: childModel.modelId,
      skills: false,
      memory: { type: "conversation" },
      maxSteps: 1,
      resolveModelTransport: async () => ({ model: childModel }),
    });

    await assertRejects(
      () => agentAsTool(child, "nested").execute({ input: "nested" }),
      Error,
      "Provider stream failed",
    );
  });
});

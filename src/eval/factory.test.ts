import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { datasets, evalAgent, evalTool, isEvalDefinition, metrics } from "veryfront/eval";

describe("eval/factory", () => {
  it("creates a first-class agent eval definition", async () => {
    const definition = evalAgent({
      id: "eval:deep-research",
      name: "Deep research eval",
      target: "agent:researcher",
      dataset: datasets.inline([
        {
          id: "q1",
          input: { question: "What is the capital of France?" },
          reference: "Paris",
          metadata: { category: "geo" },
        },
      ]),
      metrics: [metrics.answer.contains({ text: "Paris" }).gate()],
      repetitions: 2,
      tags: ["quality", "research"],
      metadata: { owner: "ai-platform" },
    });

    assertEquals(isEvalDefinition(definition), true);
    assertEquals(definition.kind, "eval");
    assertEquals(definition.targetKind, "agent");
    assertEquals(definition.id, "eval:deep-research");
    assertEquals(definition.name, "Deep research eval");
    assertEquals(definition.target, "agent:researcher");
    assertEquals(definition.repetitions, 2);
    assertEquals(definition.tags, ["quality", "research"]);
    assertEquals(definition.metadata, { owner: "ai-platform" });
    assertEquals(definition.metrics.map((metric) => metric.name), ["answer.contains"]);

    const examples = await definition.dataset.load({ baseDir: Deno.cwd() });
    assertEquals(examples, [
      {
        id: "q1",
        input: { question: "What is the capital of France?" },
        reference: "Paris",
        metadata: { category: "geo" },
      },
    ]);
  });

  it("creates a first-class tool eval definition", async () => {
    const definition = evalTool({
      id: "eval:lookup-tool",
      name: "Lookup tool eval",
      target: "tool:lookup_order",
      dataset: datasets.inline([
        {
          id: "order-1",
          input: { prompt: "Check A1049" },
          reference: { status: "shipped" },
        },
      ]),
      input: (example) => ({ orderId: (example.input as { prompt: string }).prompt.slice(-5) }),
      metrics: [metrics.agent.calledTool("lookup_order").gate()],
      repetitions: 2,
      tags: ["tool"],
      metadata: { owner: "support" },
    });

    assertEquals(isEvalDefinition(definition), true);
    assertEquals(definition.kind, "eval");
    assertEquals(definition.targetKind, "tool");
    assertEquals(definition.id, "eval:lookup-tool");
    assertEquals(definition.name, "Lookup tool eval");
    assertEquals(definition.target, "tool:lookup_order");
    assertEquals(definition.repetitions, 2);
    assertEquals(definition.tags, ["tool"]);
    assertEquals(definition.metadata, { owner: "support" });
    assertEquals(definition.metrics.map((metric) => metric.name), ["agent.calledTool"]);
    assertEquals(
      await definition.input?.({
        id: "order-1",
        input: { prompt: "Check A1049" },
        reference: { status: "shipped" },
      }),
      { orderId: "A1049" },
    );
  });

  it("does not export unfinished target factories", async () => {
    const mod = await import("veryfront/eval") as Record<string, unknown>;

    assertEquals("evalTask" in mod, false);
    assertEquals("evalWorkflow" in mod, false);
  });

  it("validates the target, dataset, and repetitions", () => {
    assertThrows(
      () =>
        evalAgent({
          target: "",
          dataset: datasets.inline([{ id: "q1", input: "hello" }]),
        }),
      Error,
      "target",
    );

    assertThrows(
      () =>
        evalAgent({
          target: "agent:researcher",
          dataset: datasets.inline([{ id: "q1", input: "hello" }]),
          repetitions: 0,
        }),
      Error,
      "repetitions",
    );

    assertThrows(
      () =>
        evalAgent({
          target: "agent:researcher",
          dataset: datasets.inline([{ id: "q1" } as never]),
        }),
      Error,
      "input",
    );
  });
});

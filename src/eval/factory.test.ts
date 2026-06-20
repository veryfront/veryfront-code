import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { datasets, evalAgent, isEvalDefinition, metrics } from "veryfront/eval";

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

  it("keeps V1 scoped to evalAgent instead of exporting unfinished target factories", async () => {
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

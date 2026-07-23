import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { evalAgent, runEval } from "veryfront/eval";
import type { EvalDataset, EvalMetric } from "veryfront/eval";
import type { EvalReportExporterRegistry } from "#veryfront/extensions/eval";

function customDataset(examples: Awaited<ReturnType<EvalDataset["load"]>>): EvalDataset {
  return {
    kind: "inline",
    load: () => Promise.resolve(examples),
  };
}

function customMetric(evaluate: EvalMetric["evaluate"]): EvalMetric {
  return {
    name: "test.custom",
    family: "check",
    severity: "gate",
    evaluate,
    gate() {
      return this;
    },
    soft() {
      return this;
    },
    budget() {
      return this;
    },
  };
}

describe("eval/runner hardening", () => {
  it("validates examples returned by custom dataset loaders", async () => {
    const definition = evalAgent({
      target: "agent:test",
      dataset: customDataset([
        { id: "same", input: "one" },
        { id: "same", input: "two" },
      ]),
    });

    await assertRejects(
      () => runEval(definition, { adapters: { agent: () => "ok" } }),
      Error,
      "Duplicate eval example id",
    );
  });

  it("records metric and check failures instead of losing the whole report", async () => {
    const brokenMetric: EvalMetric = {
      name: "test.broken",
      family: "check",
      severity: "gate",
      evaluate() {
        throw new Error("metric exploded");
      },
      gate() {
        return this;
      },
      soft() {
        return this;
      },
      budget() {
        return this;
      },
    };
    const definition = evalAgent({
      target: "agent:test",
      dataset: [{ id: "case", input: "hello" }],
      metrics: [brokenMetric],
      check() {
        throw new Error("check exploded");
      },
    });

    const report = await runEval(definition, { adapters: { agent: () => "ok" } });
    assertEquals(report.summary.failed, 1);
    assertEquals(report.records[0]?.metrics, [{
      name: "test.broken",
      family: "check",
      severity: "gate",
      pass: false,
      explanation: "Metric evaluation failed: metric exploded",
    }]);
    assertEquals(report.records[0]?.completed, false);
    assertEquals(report.records[0]?.error, "Eval check failed: check exploded");
  });

  it("applies fluent check thresholds to the recorded pass decision", async () => {
    const definition = evalAgent({
      target: "agent:test",
      dataset: [{ id: "case", input: "hello" }],
      check({ expect }) {
        expect.completed().gate({ min: 2 });
      },
    });

    const report = await runEval(definition, { adapters: { agent: () => "ok" } });
    assertEquals(report.summary.failed, 1);
    assertEquals(report.records[0]?.checks?.[0]?.pass, false);
    assertEquals(report.records[0]?.checks?.[0]?.evidence, {
      threshold: { min: 2 },
    });
  });

  it("turns malformed metric results into explicit metric failures", async () => {
    const definition = evalAgent({
      target: "agent:test",
      dataset: [{ id: "case", input: "hello" }],
      metrics: [customMetric(() => null as never)],
    });

    const report = await runEval(definition, { adapters: { agent: () => "ok" } });
    assertEquals(report.summary.failed, 1);
    assertEquals(report.records[0]?.metrics?.[0]?.name, "test.custom");
    assertEquals(report.records[0]?.metrics?.[0]?.pass, false);
    assertStringIncludes(
      report.records[0]?.metrics?.[0]?.explanation ?? "",
      "must return an object",
    );
  });

  it("snapshots repetition control before adapters execute", async () => {
    const definition = evalAgent({
      target: "agent:test",
      dataset: [{ id: "case", input: "hello" }],
    });
    let calls = 0;

    const report = await runEval(definition, {
      adapters: {
        agent: () => {
          calls += 1;
          definition.repetitions = 10_000;
          return "ok";
        },
      },
    });

    assertEquals(calls, 1);
    assertEquals(report.records.length, 1);
  });

  it("rejects invalid runtime definitions, timestamps, and custom run ids", async () => {
    const definition = evalAgent({
      target: "agent:test",
      dataset: [{ id: "case", input: "hello" }],
    });
    definition.repetitions = 0;
    await assertRejects(
      () => runEval(definition, { adapters: { agent: () => "ok" } }),
      Error,
      "definition",
    );

    const validDefinition = evalAgent({
      target: "agent:test",
      dataset: [{ id: "case", input: "hello" }],
    });
    await assertRejects(
      () =>
        runEval(validDefinition, {
          adapters: { agent: () => "ok" },
          runId: "run",
          now: () => new Date(Number.NaN),
        }),
      Error,
      "date",
    );
    await assertRejects(
      () =>
        runEval(validDefinition, {
          adapters: { agent: () => "ok" },
          runId: "../unsafe",
        }),
      Error,
      "run id",
    );
  });

  it("fails malformed adapter results without corrupting report aggregates", async () => {
    const definition = evalAgent({
      target: "agent:test",
      dataset: [{ id: "case", input: "hello" }],
    });
    const report = await runEval(definition, {
      adapters: {
        agent: () => ({
          text: "ok",
          usage: { totalTokens: -1 },
        }),
      },
    });

    assertEquals(report.summary.failed, 1);
    assertEquals(report.records[0]?.completed, false);
    assertStringIncludes(report.records[0]?.error ?? "", "usage.totalTokens");
    assertEquals(Number.isFinite(report.summary.duration?.totalMs), true);
  });

  it("rejects evals whose example and repetition product exceeds the run limit", async () => {
    const definition = evalAgent({
      target: "agent:test",
      dataset: Array.from({ length: 11 }, (_, index) => ({
        id: `case-${index}`,
        input: "hello",
      })),
      repetitions: 10_000,
    });

    await assertRejects(
      () => runEval(definition, { adapters: { agent: () => "ok" } }),
      Error,
      "100000-record limit",
    );
  });

  it("contains exporter failures without exposing backend details", async () => {
    const definition = evalAgent({
      target: "agent:test",
      dataset: [{ id: "case", input: "hello" }],
    });
    const registry = {
      get() {
        throw new Error("Authorization failed for token=sensitive");
      },
    } as unknown as EvalReportExporterRegistry;
    const report = await runEval(definition, {
      adapters: { agent: () => "ok" },
      export: { registry, exporterIds: ["capture"] },
    });

    assertEquals(report.exports, [{
      exporterId: "capture",
      ok: false,
      error: "Authorization failed for token=<REDACTED>",
    }]);
  });

  it("redacts common secret forms from adapter failures", async () => {
    const definition = evalAgent({
      target: "agent:test",
      dataset: [{ id: "case", input: "hello" }],
    });
    const report = await runEval(definition, {
      adapters: {
        agent: () => {
          throw new Error("Provider failed with token=sensitive-value");
        },
      },
    });

    assertEquals(report.records[0]?.error, "Provider failed with token=<REDACTED>");
  });

  it("rejects invalid exporter selections instead of falling back to all exporters", async () => {
    const definition = evalAgent({
      target: "agent:test",
      dataset: [{ id: "case", input: "hello" }],
    });
    await assertRejects(
      () =>
        runEval(definition, {
          adapters: { agent: () => "ok" },
          export: { exporterIds: [""] },
        }),
      Error,
      "exporter id",
    );
  });
});

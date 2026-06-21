import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { datasets, evalAgent, metrics, runEval } from "veryfront/eval";
import { createEvalReportExporterRegistry } from "veryfront/extensions/eval";

describe("eval/runner", () => {
  it("runs an agent eval and summarizes metric results", async () => {
    const definition = evalAgent({
      id: "eval:capital-answer",
      target: "agent:researcher",
      dataset: datasets.inline([
        { id: "q1", input: "France capital?", reference: "Paris" },
        { id: "q2", input: "Germany capital?", reference: "Berlin" },
      ]),
      metrics: [metrics.answer.exactMatch().gate()],
    });

    const report = await runEval(definition, {
      adapters: {
        agent: async ({ example }) => ({ text: example.reference as string }),
      },
    });

    assertEquals(report.kind, "eval-report");
    assertEquals(report.definitionId, "eval:capital-answer");
    assertEquals(report.target, "agent:researcher");
    assertEquals(report.summary.records, 2);
    assertEquals(report.summary.passed, 2);
    assertEquals(report.summary.failed, 0);
    assertEquals(report.summary.passRate, 1);
    assertEquals(report.summary.metrics, [
      {
        name: "answer.exactMatch",
        family: "answer",
        severity: "gate",
        passed: 2,
        failed: 0,
        skipped: 0,
        passRate: 1,
      },
    ]);
  });

  it("records check assertions alongside metric results", async () => {
    const definition = evalAgent({
      id: "eval:check-api",
      target: "agent:researcher",
      dataset: datasets.inline([{ id: "q1", input: "France capital?", reference: "Paris" }]),
      check(ctx) {
        ctx.expect.completed().gate();
        ctx.expect.outputContains("Paris").gate();
      },
    });

    const report = await runEval(definition, {
      adapters: {
        agent: async () => ({ text: "Paris" }),
      },
    });

    const record = report.records[0];
    assertExists(record);
    assertEquals(record.checks?.map((check) => check.name), [
      "expect.completed",
      "expect.outputContains",
    ]);
    assertEquals(report.summary.passed, 1);
  });

  it("counts adapter errors as failed records even without metrics", async () => {
    const definition = evalAgent({
      id: "eval:adapter-error",
      target: "agent:researcher",
      dataset: datasets.inline([{ id: "q1", input: "France capital?" }]),
    });

    const report = await runEval(definition, {
      adapters: {
        agent: async () => {
          throw new Error("AG-UI request failed");
        },
      },
    });

    assertEquals(report.summary.records, 1);
    assertEquals(report.summary.passed, 0);
    assertEquals(report.summary.failed, 1);
    assertEquals(report.summary.passRate, 0);
    assertEquals(report.records[0]?.completed, false);
    assertEquals(report.records[0]?.error, "AG-UI request failed");
  });

  it("exports completed reports through selected eval report exporters", async () => {
    const registry = createEvalReportExporterRegistry();
    const exportedReports: unknown[] = [];

    registry.register({
      id: "capture",
      export(report, context) {
        exportedReports.push({ report, context });
        return {
          externalRunId: "capture-run-1",
          url: "https://evals.example.test/runs/capture-run-1",
        };
      },
    });

    const definition = evalAgent({
      id: "eval:export",
      target: "agent:researcher",
      dataset: datasets.inline([
        {
          id: "q1",
          input: { prompt: "France capital?", secret: "private" },
          reference: "Paris",
          metadata: { dataset: "smoke", tenantId: "tenant-private" },
        },
      ]),
      metrics: [metrics.answer.exactMatch().gate()],
    });

    const report = await runEval(definition, {
      adapters: {
        agent: async () => ({ text: "Paris" }),
      },
      export: {
        registry,
        exporterIds: ["capture", "missing"],
        context: {
          projectReference: "docs-agent",
          sourcePath: "evals/export.eval.ts",
          redaction: { metadataAllowlist: ["dataset"] },
        },
      },
    });

    assertEquals(report.exports, [
      {
        exporterId: "capture",
        ok: true,
        receipt: {
          externalRunId: "capture-run-1",
          url: "https://evals.example.test/runs/capture-run-1",
        },
      },
      {
        exporterId: "missing",
        ok: false,
        error: 'No EvalReportExporter registered for "missing".',
      },
    ]);
    assertEquals(exportedReports.length, 1);
    const exported = exportedReports[0] as {
      report: { records: Array<{ input: unknown; reference?: unknown; metadata: unknown }> };
      context: unknown;
    };
    assertEquals(exported.report.records[0]?.input, "[redacted]");
    assertEquals(exported.report.records[0]?.reference, "[redacted]");
    assertEquals(exported.report.records[0]?.metadata, { dataset: "smoke" });
    assertEquals(exported.context, {
      projectReference: "docs-agent",
      sourcePath: "evals/export.eval.ts",
      redaction: { metadataAllowlist: ["dataset"] },
    });
  });
});

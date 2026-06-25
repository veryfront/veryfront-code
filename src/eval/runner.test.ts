import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { datasets, evalAgent, metrics, runEval } from "veryfront/eval";
import { createEvalReportExporterRegistry } from "veryfront/extensions/eval";
import {
  _resetShimForTests,
  type MetricsAPI,
  setGlobalActiveSpanAccessor,
  setGlobalMetricsAPI,
  type Span,
} from "../observability/tracing/api-shim.ts";
import { metrics as runtimeMetrics } from "#veryfront/metrics";

describe("eval/runner", () => {
  afterEach(() => {
    _resetShimForTests();
    runtimeMetrics.__resetForTests();
  });

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

  it("records agent tool behavior checks", async () => {
    const definition = evalAgent({
      id: "eval:tool-checks",
      target: "agent:support",
      dataset: datasets.inline([{ id: "refund", input: "Process refund A1049" }]),
      check(ctx) {
        ctx.expect.calledTool("orders_lookup", {
          input: { orderId: "A1049" },
          match: "partial",
        }).gate();
        ctx.expect.notCalledTool("refunds_issue").gate();
        ctx.expect.toolCallCount("orders_lookup", { exact: 1 }).gate();
      },
    });

    const report = await runEval(definition, {
      adapters: {
        agent: async () => ({
          text: "I need to verify eligibility before issuing a refund.",
          trace: {
            toolCalls: [
              {
                name: "orders_lookup",
                status: "ok",
                input: { orderId: "A1049", includeHistory: true },
              },
              { name: "policy_lookup", status: "ok", input: { topic: "refunds" } },
            ],
          },
        }),
      },
    });

    const record = report.records[0];
    assertExists(record);
    assertEquals(record.checks?.map((check) => check.name), [
      "expect.calledTool",
      "expect.notCalledTool",
      "expect.toolCallCount",
    ]);
    assertEquals(record.checks?.map((check) => check.pass), [true, true, true]);
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

  it("emits eval result and duration metrics through the runtime metrics API", async () => {
    const counterCalls: unknown[] = [];
    const histogramCalls: unknown[] = [];

    setGlobalMetricsAPI({
      getMeter() {
        return {
          createCounter(name: string) {
            return {
              add(value: number, attributes?: Record<string, unknown>) {
                counterCalls.push({ name, value, attributes });
              },
            };
          },
          createHistogram(name: string) {
            return {
              record(value: number, attributes?: Record<string, unknown>) {
                histogramCalls.push({ name, value, attributes });
              },
            };
          },
          createUpDownCounter() {
            return { add() {} };
          },
          createObservableGauge() {
            return { addCallback() {} };
          },
        };
      },
    } as MetricsAPI);

    const definition = evalAgent({
      id: "metrics-smoke-runtime",
      target: "agent:researcher",
      dataset: datasets.inline([
        { id: "q1", input: "France capital?", reference: "Paris" },
      ]),
      metrics: [metrics.answer.contains({ text: "Paris" }).gate()],
    });

    await runEval(definition, {
      adapters: {
        agent: async () => ({ text: "Paris", durationMs: 1558 }),
      },
    });

    assertEquals(counterCalls, [
      {
        name: "vf_eval_result_total",
        value: 1,
        attributes: {
          eval_id: "metrics-smoke-runtime",
          target_kind: "agent",
          metric: "answer.contains",
          family: "answer",
          severity: "gate",
          outcome: "pass",
        },
      },
    ]);
    assertEquals(histogramCalls, [
      {
        name: "vf_eval_duration_ms",
        value: 1558,
        attributes: {
          eval_id: "metrics-smoke-runtime",
          target_kind: "agent",
          metric: "duration",
          outcome: "pass",
        },
      },
    ]);
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

  it("adds the active runtime trace context to eval report exports", async () => {
    const registry = createEvalReportExporterRegistry();
    const exportedContexts: unknown[] = [];

    registry.register({
      id: "capture",
      export(_report, context) {
        exportedContexts.push(context);
      },
    });

    setGlobalActiveSpanAccessor({
      getActiveSpan: () => ({
        spanContext: () => ({
          traceId: "trace-1234567890abcdef1234567890abcdef",
          spanId: "span-1234567890",
          traceFlags: 1,
        }),
      } as Span),
      getSpan: () => undefined,
    });

    const definition = evalAgent({
      id: "eval:trace-export",
      target: "agent:researcher",
      dataset: datasets.inline([{ id: "q1", input: "France capital?", reference: "Paris" }]),
      metrics: [metrics.answer.exactMatch().gate()],
    });

    await runEval(definition, {
      adapters: {
        agent: async () => ({ text: "Paris" }),
      },
      export: {
        registry,
        exporterIds: ["capture"],
        context: {
          projectReference: "docs-agent",
        },
      },
    });

    assertEquals(exportedContexts, [
      {
        projectReference: "docs-agent",
        trace: {
          traceId: "trace-1234567890abcdef1234567890abcdef",
          spanId: "span-1234567890",
        },
      },
    ]);
  });

  it("preserves explicit eval report export trace context", async () => {
    const registry = createEvalReportExporterRegistry();
    const exportedContexts: unknown[] = [];

    registry.register({
      id: "capture",
      export(_report, context) {
        exportedContexts.push(context);
      },
    });

    setGlobalActiveSpanAccessor({
      getActiveSpan: () => ({
        spanContext: () => ({
          traceId: "active-trace",
          spanId: "active-span",
          traceFlags: 1,
        }),
      } as Span),
      getSpan: () => undefined,
    });

    const definition = evalAgent({
      id: "eval:explicit-trace-export",
      target: "agent:researcher",
      dataset: datasets.inline([{ id: "q1", input: "France capital?", reference: "Paris" }]),
      metrics: [metrics.answer.exactMatch().gate()],
    });

    await runEval(definition, {
      adapters: {
        agent: async () => ({ text: "Paris" }),
      },
      export: {
        registry,
        exporterIds: ["capture"],
        context: {
          trace: {
            traceId: "explicit-trace",
            spanId: "explicit-span",
            parentSpanId: "explicit-parent",
          },
        },
      },
    });

    assertEquals(exportedContexts, [
      {
        trace: {
          traceId: "explicit-trace",
          spanId: "explicit-span",
          parentSpanId: "explicit-parent",
        },
      },
    ]);
  });
});

import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { EvalReport } from "veryfront/eval";
import {
  createEvalReportExporterRegistry,
  redactEvalReportForExport,
} from "veryfront/extensions/eval";

function createReport(): EvalReport {
  return {
    kind: "eval-report",
    runId: "evalrun_test",
    definitionId: "eval:deep-research",
    targetKind: "agent",
    target: "agent:researcher",
    startedAt: "2026-01-01T00:00:00.000Z",
    endedAt: "2026-01-01T00:00:02.000Z",
    summary: {
      records: 1,
      passed: 1,
      failed: 0,
      passRate: 1,
      metrics: [
        {
          name: "answer.semanticSimilarity",
          family: "answer",
          severity: "gate",
          passed: 1,
          failed: 0,
          skipped: 0,
          passRate: 1,
        },
      ],
    },
    records: [
      {
        id: "q1:1",
        evalId: "eval:deep-research",
        exampleId: "q1",
        repetition: 1,
        input: { question: "What changed?", privateContext: "secret" },
        output: { text: "The plan changed." },
        reference: { text: "Plan update" },
        metadata: { topic: "planning", tenantId: "tenant-secret" },
        trace: {
          events: [{ type: "message", content: "private model output" }],
          toolCalls: [{
            id: "tool_1",
            name: "search",
            status: "ok",
            input: { query: "private docs" },
            output: { title: "private result" },
            metadata: { query: "secret" },
          }],
        },
        usage: { totalTokens: 42, costUsd: 0.01 },
        durationMs: 120,
        completed: true,
        metrics: [
          {
            name: "answer.semanticSimilarity",
            family: "answer",
            severity: "gate",
            score: 0.91,
            pass: true,
            explanation: "The private answer matched.",
            evidence: { output: "The plan changed.", reference: "Plan update" },
          },
        ],
        checks: [],
      },
    ],
  };
}

describe("EvalReportExporterRegistry", () => {
  it("exports redacted reports to registered exporters in insertion order", async () => {
    const registry = createEvalReportExporterRegistry();
    const received: string[] = [];
    const exportedReports: EvalReport[] = [];

    registry.register({
      id: "braintrust",
      export(report) {
        received.push("braintrust");
        exportedReports.push(report);
        return { externalRunId: "bt-run-1", url: "https://braintrust.example/runs/1" };
      },
    });
    registry.register({
      id: "langfuse",
      export(report) {
        received.push("langfuse");
        exportedReports.push(report);
      },
    });

    const results = await registry.export(createReport(), {
      projectReference: "demo",
      sourcePath: "evals/deep-research.ts",
      redaction: { metadataAllowlist: ["topic"] },
    });

    assertEquals(received, ["braintrust", "langfuse"]);
    assertEquals(results, [
      {
        exporterId: "braintrust",
        ok: true,
        receipt: { externalRunId: "bt-run-1", url: "https://braintrust.example/runs/1" },
      },
      { exporterId: "langfuse", ok: true },
    ]);
    const exportedReport = exportedReports[0];
    assert(exportedReport);
    const exportedRecord = exportedReport.records[0];
    assert(exportedRecord);
    assertEquals(exportedRecord.input, "[redacted]");
    assertEquals(exportedRecord.output, "[redacted]");
    assertEquals(exportedRecord.reference, "[redacted]");
    assertEquals(exportedRecord.metadata, { topic: "planning" });
    assertEquals(exportedRecord.trace, { events: [], toolCalls: [] });
    assertEquals(exportedRecord.metrics?.[0]?.explanation, undefined);
    assertEquals(exportedRecord.metrics?.[0]?.evidence, undefined);
  });

  it("continues exporting when one exporter fails", async () => {
    const registry = createEvalReportExporterRegistry();
    let secondExporterCalled = false;

    registry.register({
      id: "offline",
      export() {
        throw new Error("backend unavailable");
      },
    });
    registry.register({
      id: "langsmith",
      export() {
        secondExporterCalled = true;
      },
    });

    const results = await registry.export(createReport());

    assert(secondExporterCalled);
    assertEquals(results, [
      { exporterId: "offline", ok: false, error: "backend unavailable" },
      { exporterId: "langsmith", ok: true },
    ]);
  });

  it("redacts export context metadata unless keys are explicitly allowed", async () => {
    const registry = createEvalReportExporterRegistry();
    const exportedContexts: unknown[] = [];

    registry.register({
      id: "capture",
      export(_report, context) {
        exportedContexts.push(context);
      },
    });

    await registry.export(createReport(), {
      metadata: {
        release: "2026-01-01",
        tenantId: "tenant-secret",
      },
      redaction: { metadataAllowlist: ["release"] },
    });

    assertEquals(exportedContexts, [
      {
        metadata: { release: "2026-01-01" },
        redaction: { metadataAllowlist: ["release"] },
      },
    ]);
  });

  it("keeps full record fields only when export redaction explicitly allows them", () => {
    const redacted = redactEvalReportForExport(createReport(), {
      includeInputs: true,
      includeOutputs: true,
      includeReferences: true,
      includeTraces: true,
      includeMetricEvidence: true,
      includeMetricExplanations: true,
      metadataAllowlist: ["topic", "tenantId"],
    });
    const record = redacted.records[0];
    assert(record);

    assertEquals(record.input, {
      question: "What changed?",
      privateContext: "secret",
    });
    assertEquals(record.output, { text: "The plan changed." });
    assertEquals(record.reference, { text: "Plan update" });
    assertEquals(record.metadata, { topic: "planning", tenantId: "tenant-secret" });
    assertEquals(record.trace.events.length, 1);
    assertEquals(record.trace.toolCalls.length, 1);
    assertEquals(record.trace.toolCalls[0], {
      id: "tool_1",
      name: "search",
      status: "ok",
      input: { query: "private docs" },
      output: { title: "private result" },
      metadata: { query: "secret" },
    });
    assertEquals(record.metrics?.[0]?.explanation, "The private answer matched.");
    assertEquals(record.metrics?.[0]?.evidence, {
      output: "The plan changed.",
      reference: "Plan update",
    });
  });
});

import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
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
    dataset: {
      kind: "json",
      path: "private/evals/deep-research.json",
      examples: 1,
      hash: "sha256:fixture-dataset",
    },
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
          label: 'Answer contained "the private launch codename"',
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
        executionInput: { query: "private docs" },
        output: { text: "The plan changed." },
        reference: { text: "Plan update" },
        metadata: { topic: "planning", tenantId: "tenant-secret" },
        retrievedContext: [{
          source: "internal-doc-1",
          title: "Private roadmap",
          content: "secret roadmap passage",
          metadata: { tenantId: "tenant-secret" },
        }],
        citations: [{
          source: "internal-doc-1",
          text: "[1]",
          quote: "secret roadmap passage",
          metadata: { tenantId: "tenant-secret" },
        }],
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
            label: 'Answer contained "the private launch codename"',
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
    assertEquals(exportedRecord.executionInput, "[redacted]");
    assertEquals(exportedRecord.output, "[redacted]");
    assertEquals(exportedRecord.reference, "[redacted]");
    assertEquals(exportedRecord.retrievedContext, []);
    assertEquals(exportedRecord.citations, []);
    assertEquals(exportedRecord.metadata, { topic: "planning" });
    assertEquals(exportedRecord.trace, { events: [], toolCalls: [] });
    assertEquals(exportedRecord.metrics?.[0]?.explanation, undefined);
    assertEquals(exportedRecord.metrics?.[0]?.evidence, undefined);
    // The label spells out the metric's configured parameter, which is the same class of detail
    // `evidence` carries, so it must not survive redaction either.
    assertEquals(exportedRecord.metrics?.[0]?.label, undefined);
    assertEquals(exportedReport.summary.metrics[0]?.label, undefined);
    // The dataset hash is a deterministic digest of every example's id, input, reference, and
    // metadata, so it identifies dataset content across runs and must not survive redaction.
    assertEquals(exportedReport.dataset, {
      kind: "json",
      examples: 1,
    });
  });

  it("strips the dataset content hash unless export redaction explicitly allows it", () => {
    const defaultRedacted = redactEvalReportForExport(createReport());
    assertEquals(defaultRedacted.dataset, { kind: "json", examples: 1 });

    const hashAllowed = redactEvalReportForExport(createReport(), {
      includeDatasetHash: true,
    });
    assertEquals(hashAllowed.dataset, {
      kind: "json",
      examples: 1,
      hash: "sha256:fixture-dataset",
    });
  });

  it("leaves reports without dataset metadata untouched", () => {
    // `EvalReport.dataset` is absent whenever the run had no resolvable dataset identity, so
    // redaction must not synthesize an empty dataset object for exporters to trip over.
    const report = createReport();
    delete report.dataset;

    assertEquals(redactEvalReportForExport(report).dataset, undefined);
    assertEquals(
      redactEvalReportForExport(report, {
        includeDatasetPath: true,
        includeDatasetHash: true,
      }).dataset,
      undefined,
    );
  });

  it("uses call-time exporter membership throughout an in-flight export", async () => {
    const registry = createEvalReportExporterRegistry();
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const calls: string[] = [];

    registry.register({
      id: "blocking",
      async export() {
        calls.push("blocking");
        started.resolve();
        await release.promise;
      },
    });
    registry.register({
      id: "registered-at-start",
      export() {
        calls.push("registered-at-start");
      },
    });

    const inFlight = registry.export(createReport());
    await started.promise;

    registry.unregister("registered-at-start");
    registry.register({
      id: "registered-late",
      export() {
        calls.push("registered-late");
      },
    });
    release.resolve();

    const results = await inFlight;
    assertEquals(calls, ["blocking", "registered-at-start"]);
    assertEquals(results.map((result) => result.exporterId), [
      "blocking",
      "registered-at-start",
    ]);
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

  it("continues after a thrown value whose coercion also throws", async () => {
    const registry = createEvalReportExporterRegistry();
    let secondExporterCalled = false;
    const hostileThrownValue = {
      toString(): string {
        throw new Error("coercion escaped");
      },
    };

    registry.register({
      id: "hostile",
      export() {
        throw hostileThrownValue;
      },
    });
    registry.register({
      id: "healthy",
      export() {
        secondExporterCalled = true;
      },
    });

    assertEquals(await registry.export(createReport()), [
      {
        exporterId: "hostile",
        ok: false,
        error: "[unprintable thrown value]",
      },
      { exporterId: "healthy", ok: true },
    ]);
    assert(secondExporterCalled);
  });

  it("captures the exporter id once at registration", async () => {
    const registry = createEvalReportExporterRegistry();
    let idReads = 0;
    const exporter = {
      get id(): string {
        idReads++;
        if (idReads > 1) throw new Error("id read more than once");
        return "stable";
      },
      export() {},
    };

    registry.register(exporter);

    assertEquals(await registry.export(createReport()), [
      { exporterId: "stable", ok: true },
    ]);
    assertEquals(idReads, 1);
  });

  it("rejects malformed exporter registrations", () => {
    const registry = createEvalReportExporterRegistry();

    assertThrows(
      () => registry.register({ id: " ", export() {} }),
      TypeError,
      "non-empty canonical string",
    );
    assertThrows(
      () =>
        registry.register({
          id: "missing-export",
        } as never),
      TypeError,
      'method "export"',
    );
  });

  it("register is first-write-wins for duplicate exporter ids", () => {
    const registry = createEvalReportExporterRegistry();
    const first = { id: "braintrust", export() {} };
    const second = { id: "braintrust", export() {} };

    registry.register(first);
    registry.register(second);

    assertEquals(
      registry.get("braintrust"),
      first,
      "duplicate registration must not replace the first exporter",
    );
    assertEquals(
      registry.list().length,
      1,
      "a duplicate exporter id must not add a second registration",
    );
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

  it("isolates exporter context mutations from later redaction decisions", async () => {
    const registry = createEvalReportExporterRegistry();
    const exportedReports: EvalReport[] = [];
    const exportedContexts: unknown[] = [];

    registry.register({
      id: "mutator",
      export(_report, context) {
        context.redaction ??= {};
        context.redaction.includeInputs = true;
        context.redaction.metadataAllowlist?.push("tenantId");
        context.metadata = { tenantId: "mutated" };
        context.tags?.push("leaked");
        if (context.trace) context.trace.traceId = "leaked";
      },
    });
    registry.register({
      id: "capture",
      export(report, context) {
        exportedReports.push(report);
        exportedContexts.push(context);
      },
    });

    const context = {
      tags: ["nightly"],
      trace: { traceId: "trace-1", spanId: "span-1" },
      metadata: {
        topic: "planning",
        tenantId: "tenant-secret",
      },
      redaction: { metadataAllowlist: ["topic"] },
    };

    await registry.export(createReport(), context);

    const exportedRecord = exportedReports[0]?.records[0];
    assert(exportedRecord);
    assertEquals(exportedRecord.input, "[redacted]");
    assertEquals(exportedRecord.metadata, { topic: "planning" });
    assertEquals(exportedContexts, [
      {
        tags: ["nightly"],
        trace: { traceId: "trace-1", spanId: "span-1" },
        metadata: { topic: "planning" },
        redaction: { metadataAllowlist: ["topic"] },
      },
    ]);
    assertEquals(context, {
      tags: ["nightly"],
      trace: { traceId: "trace-1", spanId: "span-1" },
      metadata: {
        topic: "planning",
        tenantId: "tenant-secret",
      },
      redaction: { metadataAllowlist: ["topic"] },
    });
  });

  it("keeps full record fields only when export redaction explicitly allows them", () => {
    const redacted = redactEvalReportForExport(createReport(), {
      includeInputs: true,
      includeOutputs: true,
      includeReferences: true,
      includeTraces: true,
      includeRetrievedContext: true,
      includeCitations: true,
      includeMetricEvidence: true,
      includeMetricExplanations: true,
      includeDatasetPath: true,
      includeDatasetHash: true,
      metadataAllowlist: ["topic", "tenantId"],
    });
    const record = redacted.records[0];
    assert(record);

    assertEquals(record.input, {
      question: "What changed?",
      privateContext: "secret",
    });
    assertEquals(record.executionInput, { query: "private docs" });
    assertEquals(record.output, { text: "The plan changed." });
    assertEquals(record.reference, { text: "Plan update" });
    assertEquals(record.retrievedContext, [{
      source: "internal-doc-1",
      title: "Private roadmap",
      content: "secret roadmap passage",
      metadata: { tenantId: "tenant-secret" },
    }]);
    assertEquals(record.citations, [{
      source: "internal-doc-1",
      text: "[1]",
      quote: "secret roadmap passage",
      metadata: { tenantId: "tenant-secret" },
    }]);
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
    assertEquals(
      record.metrics?.[0]?.label,
      'Answer contained "the private launch codename"',
      "metric label must survive when includeMetricEvidence allows evidence",
    );
    assertEquals(
      redacted.summary.metrics[0]?.label,
      'Answer contained "the private launch codename"',
      "summary metric label must survive when includeMetricEvidence allows evidence",
    );
    assertEquals(redacted.dataset, {
      kind: "json",
      path: "private/evals/deep-research.json",
      examples: 1,
      hash: "sha256:fixture-dataset",
    });
  });
});

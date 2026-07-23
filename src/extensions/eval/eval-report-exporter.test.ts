import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontError } from "#veryfront/errors";
import type { EvalReport } from "veryfront/eval";
import {
  createEvalReportExporterRegistry,
  type EvalReportExporter,
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
        },
      ],
      gateFailures: [{
        recordId: "q1:1",
        exampleId: "q1",
        repetition: 1,
        name: "record.error",
        family: "check",
        severity: "gate",
        explanation: "private provider failure",
        evidence: { token: "secret" },
      }],
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
        error: "private provider failure",
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
    exports: [{
      exporterId: "previous",
      ok: false,
      error: "private previous exporter failure",
    }],
    metadata: {
      model: "private/model",
      provenance: {
        kind: "eval-run-provenance",
        environment: "local",
        source: { kind: "git", id: "private-repository" },
      },
    },
  };
}

describe("EvalReportExporterRegistry", () => {
  it("supports lookup, listing, and removal with typed missing-exporter errors", () => {
    const registry = createEvalReportExporterRegistry();
    const exporter: EvalReportExporter = { id: "capture", export() {} };
    registry.register(exporter);

    assertEquals(registry.get("capture"), exporter);
    assertEquals(registry.require("capture"), exporter);
    assertEquals(registry.list(), [exporter]);
    assertEquals(registry.has("capture"), true);
    registry.unregister("capture");
    assertEquals(registry.get("capture"), undefined);

    let thrown: unknown;
    try {
      registry.require("capture");
    } catch (error) {
      thrown = error;
    }
    assert(thrown instanceof VeryfrontError);
    assertEquals(thrown.slug, "resource-not-found");
  });

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
    assertEquals(exportedRecord.error, "[redacted]");
    assertEquals(exportedRecord.metrics?.[0]?.explanation, undefined);
    assertEquals(exportedRecord.metrics?.[0]?.evidence, undefined);
    assertEquals(exportedReport.summary.gateFailures?.[0]?.explanation, undefined);
    assertEquals(exportedReport.summary.gateFailures?.[0]?.evidence, undefined);
    assertEquals(exportedReport.exports, undefined);
    assertEquals(exportedReport.metadata, undefined);
    assertEquals(exportedReport.dataset, {
      kind: "json",
      examples: 1,
      hash: "sha256:fixture-dataset",
    });
  });

  it("drops unknown report fields instead of exporting them by default", () => {
    const report = createReport();
    report.summary.duration = {
      totalMs: 120,
      minMs: 120,
      maxMs: 120,
      meanMs: 120,
      p50Ms: 120,
      p95Ms: 120,
    };
    report.summary.usage = { totalTokens: 42 };
    const record = report.records[0]!;
    const metric = record.metrics![0]!;
    const summaryMetric = report.summary.metrics[0]!;
    const gateFailure = report.summary.gateFailures![0]!;
    const values = [
      report,
      report.dataset!,
      report.summary,
      report.summary.duration!,
      report.summary.usage!,
      summaryMetric,
      record,
      record.usage,
      metric,
      gateFailure,
    ];
    for (const value of values) {
      (value as unknown as Record<string, unknown>).futurePrivateField = "private-value";
    }

    const redacted = redactEvalReportForExport(report, {
      includeInputs: true,
      includeOutputs: true,
      includeReferences: true,
      includeMetricExplanations: true,
      includeMetricEvidence: true,
    });

    for (
      const value of [
        redacted,
        redacted.dataset!,
        redacted.summary,
        redacted.summary.duration!,
        redacted.summary.usage!,
        redacted.summary.metrics[0]!,
        redacted.records[0]!,
        redacted.records[0]!.usage,
        redacted.records[0]!.metrics![0]!,
        redacted.summary.gateFailures![0]!,
      ]
    ) {
      assertEquals(Object.hasOwn(value, "futurePrivateField"), false);
    }
  });

  it("continues exporting without exposing raw exporter failures", async () => {
    const registry = createEvalReportExporterRegistry();
    let secondExporterCalled = false;

    registry.register({
      id: "offline",
      export() {
        throw new Error("Authorization failed for token=<TOKEN>");
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
      { exporterId: "offline", ok: false, error: "Eval report export failed." },
      { exporterId: "langsmith", ok: true },
    ]);
  });

  it("removes local context paths unless export redaction explicitly allows them", async () => {
    const registry = createEvalReportExporterRegistry();
    const contexts: unknown[] = [];
    registry.register({
      id: "capture",
      export(_report, context) {
        contexts.push(context);
      },
    });

    const context = {
      projectReference: "demo",
      sourcePath: "/private/workspace/evals/support.ts",
      reportPath: "/private/workspace/.veryfront/report.json",
    };
    await registry.export(createReport(), context);
    await registry.export(createReport(), {
      ...context,
      redaction: { includeContextPaths: true },
    });

    assertEquals(contexts, [
      { projectReference: "demo" },
      {
        ...context,
        redaction: { includeContextPaths: true },
      },
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
        release: { date: "2026-01-01", channel: "stable" },
        tenantId: "tenant-secret",
      },
      redaction: { metadataAllowlist: ["release"] },
    });

    assertEquals(exportedContexts, [
      {
        metadata: { release: { date: "2026-01-01", channel: "stable" } },
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
      export(report, context) {
        const firstMetric = report.summary.metrics[0];
        if (firstMetric) firstMetric.name = "mutated";
        context.redaction ??= {};
        context.redaction.includeInputs = true;
        context.redaction.metadataAllowlist?.push("tenantId");
        const topic = context.metadata?.topic as { label: string };
        topic.label = "mutated";
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
      metadata: {
        topic: { label: "planning" },
        tenantId: "tenant-secret",
      },
      redaction: { metadataAllowlist: ["topic"] },
    };

    const report = createReport();
    await registry.export(report, context);

    const exportedRecord = exportedReports[0]?.records[0];
    assert(exportedRecord);
    assertEquals(exportedRecord.input, "[redacted]");
    assertEquals(exportedRecord.metadata, { topic: "planning" });
    assertEquals(exportedReports[0]?.summary.metrics[0]?.name, "answer.semanticSimilarity");
    assertEquals(report.summary.metrics[0]?.name, "answer.semanticSimilarity");
    assertEquals(exportedContexts, [
      {
        metadata: { topic: { label: "planning" } },
        redaction: { metadataAllowlist: ["topic"] },
      },
    ]);
    assertEquals(context, {
      metadata: {
        topic: { label: "planning" },
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
      includeErrors: true,
      metadataAllowlist: ["topic", "tenantId", "model", "provenance"],
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
    assertEquals(record.error, "private provider failure");
    assertEquals(redacted.summary.gateFailures?.[0]?.explanation, "private provider failure");
    assertEquals(redacted.summary.gateFailures?.[0]?.evidence, { token: "secret" });
    assertEquals(redacted.exports, undefined);
    assertEquals(redacted.metadata, {
      model: "private/model",
      provenance: {
        kind: "eval-run-provenance",
        environment: "local",
        source: { kind: "git", id: "private-repository" },
      },
    });
    assertEquals(redacted.dataset, {
      kind: "json",
      path: "private/evals/deep-research.json",
      examples: 1,
      hash: "sha256:fixture-dataset",
    });
  });

  it("copies allowlisted metadata keys without prototype mutation", () => {
    const report = createReport();
    const metadata = report.records[0]?.metadata;
    assert(metadata);
    Object.defineProperty(metadata, "__proto__", {
      enumerable: true,
      value: { marker: "safe-data" },
    });

    const redacted = redactEvalReportForExport(report, {
      metadataAllowlist: ["__proto__"],
    });
    const exportedMetadata = redacted.records[0]?.metadata;
    assert(exportedMetadata);
    assertEquals(Object.hasOwn(exportedMetadata, "__proto__"), true);
    assertEquals(exportedMetadata["__proto__"], { marker: "safe-data" });
    assertEquals(({} as Record<string, unknown>).marker, undefined);
  });

  it("uses a stable exporter snapshot for each export operation", async () => {
    const registry = createEvalReportExporterRegistry();
    const calls: string[] = [];
    const late: EvalReportExporter = {
      id: "late",
      export() {
        calls.push("late");
      },
    };
    registry.register({
      id: "first",
      export() {
        calls.push("first");
        registry.register(late);
      },
    });

    assertEquals(await registry.export(createReport()), [
      { exporterId: "first", ok: true },
    ]);
    assertEquals(calls, ["first"]);

    assertEquals(await registry.export(createReport()), [
      { exporterId: "first", ok: true },
      { exporterId: "late", ok: true },
    ]);
    assertEquals(calls, ["first", "first", "late"]);
  });

  it("rejects invalid exporters and conflicting duplicate ids", () => {
    const registry = createEvalReportExporterRegistry();
    const first: EvalReportExporter = { id: "capture", export() {} };
    registry.register(first);
    registry.register(first);

    assertThrows(
      () => registry.register({ id: "capture", export() {} }),
      Error,
      "already registered",
    );
    for (
      const id of [
        "",
        " capture",
        "capture\nlog",
        "capture,other",
        "capture/other",
        "capture other",
        "x".repeat(129),
      ]
    ) {
      assertThrows(
        () => registry.register({ id, export() {} }),
        Error,
        "Eval report exporter id",
      );
    }
    assertThrows(
      () =>
        registry.register({
          id: "missing-method",
        } as unknown as EvalReportExporter),
      Error,
      "export must be a function",
    );

    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    let error: unknown;
    try {
      registry.register(revoked.proxy as EvalReportExporter);
    } catch (caught) {
      error = caught;
    }
    assertEquals(error instanceof VeryfrontError, true);
    assertEquals(String(error).includes("revoked"), false);
  });

  it("bounds the number of registered exporters", () => {
    const registry = createEvalReportExporterRegistry();
    for (let index = 0; index < 256; index += 1) {
      registry.register({ id: `exporter-${index}`, export() {} });
    }
    assertThrows(
      () => registry.register({ id: "exporter-overflow", export() {} }),
      Error,
      "at most 256",
    );
  });

  it("fails closed when a redaction flag has a hostile runtime type", async () => {
    const registry = createEvalReportExporterRegistry();
    let called = false;
    registry.register({
      id: "capture",
      export() {
        called = true;
      },
    });

    const results = await registry.export(createReport(), {
      redaction: {
        includeInputs: "false",
      } as unknown as { includeInputs: boolean },
    });

    assertEquals(called, false);
    assertEquals(results, [{
      exporterId: "capture",
      ok: false,
      error: "Eval report export failed.",
    }]);
  });

  it("rejects falsy non-object redaction policies", async () => {
    const registry = createEvalReportExporterRegistry();
    let calls = 0;
    registry.register({
      id: "capture",
      export() {
        calls += 1;
      },
    });

    for (const redaction of [null, false, 0, ""] as const) {
      assertEquals(
        await registry.export(createReport(), {
          redaction: redaction as unknown as NonNullable<
            Parameters<typeof registry.export>[1]
          >["redaction"],
        }),
        [{ exporterId: "capture", ok: false, error: "Eval report export failed." }],
      );
    }
    assertEquals(calls, 0);
  });

  it("snapshots hostile metadata allowlists before applying redaction", async () => {
    const registry = createEvalReportExporterRegistry();
    let calls = 0;
    registry.register({
      id: "capture",
      export() {
        calls += 1;
      },
    });

    let keyReads = 0;
    const allowlist: string[] = [];
    Object.defineProperty(allowlist, 0, {
      enumerable: true,
      get() {
        keyReads += 1;
        if (keyReads > 1) throw new Error("private-second-allowlist-read");
        return "topic";
      },
    });
    assertEquals(
      await registry.export(createReport(), { redaction: { metadataAllowlist: allowlist } }),
      [{ exporterId: "capture", ok: true }],
    );
    assertEquals(keyReads, 1);

    const revoked = Proxy.revocable<string[]>([], {});
    revoked.revoke();
    assertEquals(
      await registry.export(createReport(), {
        redaction: { metadataAllowlist: revoked.proxy },
      }),
      [{ exporterId: "capture", ok: false, error: "Eval report export failed." }],
    );
    assertEquals(calls, 1);
  });

  it("sanitizes hostile report access in the public redaction helper", () => {
    const canary = "private-eval-report";
    const report = Object.defineProperty(createReport(), "records", {
      get() {
        throw new Error(canary);
      },
    });

    let error: unknown;
    try {
      redactEvalReportForExport(report);
    } catch (caught) {
      error = caught;
    }

    assertEquals(error instanceof VeryfrontError, true);
    assertEquals(String(error).includes("could not be redacted safely"), true);
    assertEquals(String(error).includes(canary), false);

    const revokedFailure = Proxy.revocable({}, {});
    revokedFailure.revoke();
    const hostileReport = Object.defineProperty(createReport(), "records", {
      get() {
        throw revokedFailure.proxy;
      },
    });
    assertThrows(
      () => redactEvalReportForExport(hostileReport),
      VeryfrontError,
      "could not be redacted safely",
    );
  });

  it("contains hostile export context access failures", async () => {
    const registry = createEvalReportExporterRegistry();
    registry.register({ id: "capture", export() {} });
    const context = Object.defineProperty({}, "redaction", {
      get() {
        throw new Error("token=<TOKEN>");
      },
    });

    assertEquals(
      await registry.export(createReport(), context),
      [{ exporterId: "capture", ok: false, error: "Eval report export failed." }],
    );
  });

  it("snapshots stateful context metadata exactly once", async () => {
    const registry = createEvalReportExporterRegistry();
    const contexts: unknown[] = [];
    registry.register({
      id: "capture",
      export(_report, context) {
        contexts.push(context);
      },
    });
    let metadataReads = 0;
    const context = Object.defineProperties({}, {
      metadata: {
        enumerable: true,
        get() {
          metadataReads += 1;
          return {
            allowed: {
              label: metadataReads === 1 ? "stable" : "private-second-read",
            },
          };
        },
      },
      redaction: {
        enumerable: true,
        value: { metadataAllowlist: ["allowed"] },
      },
    });

    assertEquals(await registry.export(createReport(), context), [
      { exporterId: "capture", ok: true },
    ]);
    assertEquals(metadataReads, 1);
    assertEquals(contexts, [{
      metadata: { allowed: { label: "stable" } },
      redaction: { metadataAllowlist: ["allowed"] },
    }]);
  });

  it("snapshots context tag collections with bounded indexed reads", async () => {
    const registry = createEvalReportExporterRegistry();
    const contexts: unknown[] = [];
    registry.register({
      id: "capture",
      export(_report, context) {
        contexts.push(context);
      },
    });
    let lengthReads = 0;
    const tags = new Proxy(["stable"], {
      get(target, property, receiver) {
        if (property === "length") {
          lengthReads += 1;
          if (lengthReads > 1) throw new Error("private-second-tag-length-read");
        }
        return Reflect.get(target, property, receiver);
      },
    });

    assertEquals(await registry.export(createReport(), { tags }), [
      { exporterId: "capture", ok: true },
    ]);
    assertEquals(lengthReads, 1);
    assertEquals(contexts, [{ tags: ["stable"] }]);
  });

  it("fails closed when context fields have hostile runtime types", async () => {
    const registry = createEvalReportExporterRegistry();
    let called = false;
    registry.register({
      id: "capture",
      export() {
        called = true;
      },
    });

    const results = await registry.export(createReport(), {
      tags: "private-tag",
    } as unknown as { tags: string[] });

    assertEquals(called, false);
    assertEquals(results, [{
      exporterId: "capture",
      ok: false,
      error: "Eval report export failed.",
    }]);
  });

  it("rejects exporter id mutation after registration", () => {
    const registry = createEvalReportExporterRegistry();
    const exporter = { id: "capture", export() {} };
    registry.register(exporter);
    exporter.id = "renamed";

    assertThrows(
      () => registry.list(),
      Error,
      "cannot change after registration",
    );
    assertThrows(
      () => registry.has("capture"),
      Error,
      "cannot change after registration",
    );
  });

  it("rejects stateful exporter ids during registration", () => {
    const registry = createEvalReportExporterRegistry();
    let reads = 0;
    const exporter = {
      get id() {
        reads += 1;
        return reads === 1 ? "first" : "second";
      },
      export() {},
    };

    assertThrows(
      () => registry.register(exporter),
      Error,
      "must remain stable during registration",
    );
    assertEquals(registry.list(), []);
  });

  it("does not inspect reports or context when no exporters are registered", async () => {
    const registry = createEvalReportExporterRegistry();
    let contextReads = 0;
    const context = Object.defineProperty({}, "redaction", {
      get() {
        contextReads += 1;
        throw new Error("should not be read");
      },
    });

    assertEquals(await registry.export(createReport(), context), []);
    assertEquals(contextReads, 0);
  });

  it("isolates nested receipt metadata from exporter-owned objects", async () => {
    const registry = createEvalReportExporterRegistry();
    const receipt = {
      externalRunId: "run-1",
      metadata: { destination: { name: "stable" } },
    };
    registry.register({ id: "capture", export: () => receipt });

    const results = await registry.export(createReport());
    receipt.metadata.destination.name = "mutated";

    assertEquals(results, [{
      exporterId: "capture",
      ok: true,
      receipt: {
        externalRunId: "run-1",
        metadata: { destination: { name: "stable" } },
      },
    }]);
  });

  it("snapshots stateful receipt metadata exactly once", async () => {
    const registry = createEvalReportExporterRegistry();
    let reads = 0;
    const metadata = Object.defineProperty({}, "sequence", {
      enumerable: true,
      get() {
        reads += 1;
        return reads;
      },
    });
    registry.register({
      id: "capture",
      export: () => ({ metadata }),
    });

    assertEquals(await registry.export(createReport()), [{
      exporterId: "capture",
      ok: true,
      receipt: { metadata: { sequence: 1 } },
    }]);
    assertEquals(reads, 1);
  });

  it("fails closed when an exporter returns an invalid receipt", async () => {
    const registry = createEvalReportExporterRegistry();
    registry.register({
      id: "invalid-receipt",
      export: () => "private-invalid-receipt" as unknown as { externalRunId: string },
    });
    registry.register({
      id: "unsafe-url",
      export: () => ({ url: "javascript:alert(1)" }),
    });

    assertEquals(await registry.export(createReport()), [
      {
        exporterId: "invalid-receipt",
        ok: false,
        error: "Eval report export failed.",
      },
      {
        exporterId: "unsafe-url",
        ok: false,
        error: "Eval report export failed.",
      },
    ]);
  });

  it("rejects cyclic receipt metadata before it reaches report results", async () => {
    const registry = createEvalReportExporterRegistry();
    const metadata: Record<string, unknown> = {};
    metadata.self = metadata;
    registry.register({
      id: "cyclic-receipt",
      export: () => ({ metadata }),
    });

    assertEquals(await registry.export(createReport()), [{
      exporterId: "cyclic-receipt",
      ok: false,
      error: "Eval report export failed.",
    }]);
  });
});

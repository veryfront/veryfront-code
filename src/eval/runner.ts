import { createEvalCheckContext } from "./expect.ts";
import { createEvalReport } from "./report.ts";
import { metrics as runtimeMetrics } from "#veryfront/metrics";
import {
  createEvalReportExporterRegistry,
  type EvalReportExportContext,
  type EvalReportExporterRegistry,
  EvalReportExporterRegistryName,
  type EvalReportExportResult,
  type EvalReportExportTraceContext,
} from "#veryfront/extensions/eval";
import { trace } from "../observability/tracing/api-shim.ts";
import { tryResolve } from "../extensions/contracts.ts";
import type {
  EvalAgentAdapterResult,
  EvalDefinition,
  EvalMetricResult,
  EvalRecord,
  EvalReportExportConfig,
  EvalTrace,
  EvalUsage,
  RunEvalOptions,
} from "./types.ts";

function createRunId(now: Date): string {
  return `evalrun_${now.toISOString().replace(/[-:.]/g, "").replace("T", "_").replace("Z", "")}`;
}

function normalizeTrace(trace?: Partial<EvalTrace>): EvalTrace {
  return {
    events: trace?.events ?? [],
    toolCalls: trace?.toolCalls ?? [],
  };
}

function normalizeUsage(usage?: EvalUsage): EvalUsage {
  return usage ?? {};
}

function normalizeAdapterResult(result: string | EvalAgentAdapterResult): EvalAgentAdapterResult {
  return typeof result === "string" ? { text: result } : result;
}

function normalizeOutput(result: EvalAgentAdapterResult): unknown {
  if (Object.hasOwn(result, "output")) return result.output;
  if (Object.hasOwn(result, "json")) return { json: result.json };
  if (Object.hasOwn(result, "text")) return { text: result.text };
  return result;
}

function isBlockingFailure(record: EvalRecord): boolean {
  return [...(record.metrics ?? []), ...(record.checks ?? [])].some((result) =>
    !result.skipped && result.pass === false &&
    (result.severity === "gate" || result.severity === "budget")
  );
}

function recordPassed(record: EvalRecord): boolean {
  if (!record.completed || record.error) return false;
  return !isBlockingFailure(record);
}

function emitEvalRuntimeMetrics(report: ReturnType<typeof createEvalReport>): void {
  const baseAttributes = {
    eval_id: report.definitionId,
    target_kind: report.targetKind,
  };

  for (const metric of report.summary.metrics) {
    const common = {
      ...baseAttributes,
      metric: metric.name,
      family: metric.family,
      severity: metric.severity,
    };
    if (metric.passed > 0) {
      runtimeMetrics.counter("vf_eval_result_total", metric.passed, {
        ...common,
        outcome: "pass",
      });
    }
    if (metric.failed > 0) {
      runtimeMetrics.counter("vf_eval_result_total", metric.failed, {
        ...common,
        outcome: "fail",
      });
    }
    if (metric.skipped > 0) {
      runtimeMetrics.counter("vf_eval_result_total", metric.skipped, {
        ...common,
        outcome: "skipped",
      });
    }
  }

  if (report.summary.metrics.length === 0) {
    if (report.summary.passed > 0) {
      runtimeMetrics.counter("vf_eval_result_total", report.summary.passed, {
        ...baseAttributes,
        metric: "record",
        family: "record",
        severity: "gate",
        outcome: "pass",
      });
    }
    if (report.summary.failed > 0) {
      runtimeMetrics.counter("vf_eval_result_total", report.summary.failed, {
        ...baseAttributes,
        metric: "record",
        family: "record",
        severity: "gate",
        outcome: "fail",
      });
    }
  }

  for (const record of report.records) {
    runtimeMetrics.histogram("vf_eval_duration_ms", record.durationMs, {
      ...baseAttributes,
      metric: "duration",
      outcome: recordPassed(record) ? "pass" : "fail",
    });
  }
}

function createMissingRegistryResults(exporterIds: string[]): EvalReportExportResult[] {
  return exporterIds.map((exporterId) => ({
    exporterId,
    ok: false,
    error: "No EvalReportExporter registry resolved.",
  }));
}

function createMissingExporterResult(exporterId: string): EvalReportExportResult {
  return {
    exporterId,
    ok: false,
    error: `No EvalReportExporter registered for "${exporterId}".`,
  };
}

function resolveExporterRegistry(
  config: EvalReportExportConfig,
): EvalReportExporterRegistry | undefined {
  return config.registry ??
    tryResolve<EvalReportExporterRegistry>(EvalReportExporterRegistryName);
}

function isEmptyTraceId(value: string | undefined): boolean {
  return value === undefined || /^0+$/.test(value);
}

function getActiveEvalExportTraceContext(): EvalReportExportTraceContext | undefined {
  const spanContext = trace.getActiveSpan()?.spanContext();
  if (!spanContext) return undefined;
  if (isEmptyTraceId(spanContext.traceId) || isEmptyTraceId(spanContext.spanId)) {
    return undefined;
  }
  return {
    traceId: spanContext.traceId,
    spanId: spanContext.spanId,
  };
}

function withActiveTraceContext(
  context?: EvalReportExportContext,
): EvalReportExportContext | undefined {
  if (context?.trace) return context;

  const activeTrace = getActiveEvalExportTraceContext();
  if (!activeTrace) return context;

  return {
    ...(context ?? {}),
    trace: activeTrace,
  };
}

async function exportWithSelectedExporter(
  registry: EvalReportExporterRegistry,
  report: ReturnType<typeof createEvalReport>,
  config: EvalReportExportConfig,
  exporterId: string,
): Promise<EvalReportExportResult> {
  const exporter = registry.get(exporterId);
  if (!exporter) return createMissingExporterResult(exporterId);

  const selectedRegistry = createEvalReportExporterRegistry();
  selectedRegistry.register(exporter);
  const [result] = await selectedRegistry.export(report, withActiveTraceContext(config.context));
  return result ?? {
    exporterId,
    ok: false,
    error: `EvalReportExporter "${exporterId}" did not return an export result.`,
  };
}

async function exportEvalReport(
  report: ReturnType<typeof createEvalReport>,
  config?: EvalReportExportConfig,
): Promise<EvalReportExportResult[] | undefined> {
  if (!config) return undefined;

  const exporterIds = config.exporterIds?.filter((id) => id.length > 0) ?? [];
  const registry = resolveExporterRegistry(config);
  if (!registry) return createMissingRegistryResults(exporterIds);

  if (exporterIds.length === 0) {
    return registry.export(report, withActiveTraceContext(config.context));
  }

  const results: EvalReportExportResult[] = [];
  for (const exporterId of exporterIds) {
    results.push(await exportWithSelectedExporter(registry, report, config, exporterId));
  }
  return results;
}

async function runRecord(
  definition: EvalDefinition,
  options: RunEvalOptions,
  example: Awaited<ReturnType<EvalDefinition["dataset"]["load"]>>[number],
  repetition: number,
): Promise<EvalRecord> {
  const started = Date.now();
  let result: EvalAgentAdapterResult;

  try {
    result = normalizeAdapterResult(
      await options.adapters.agent({ definition, example, repetition }),
    );
  } catch (error) {
    result = {
      text: "",
      completed: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const output = normalizeOutput(result);
  const record: EvalRecord = {
    id: `${example.id}:${repetition}`,
    evalId: definition.id,
    exampleId: example.id,
    repetition,
    input: example.input,
    output,
    ...(Object.hasOwn(example, "reference") ? { reference: example.reference } : {}),
    metadata: example.metadata ?? {},
    trace: normalizeTrace(result.trace),
    usage: normalizeUsage(result.usage),
    durationMs: result.durationMs ?? Date.now() - started,
    completed: result.completed ?? !result.error,
    ...(result.error ? { error: result.error } : {}),
  };

  const metricResults = [];
  for (const metric of definition.metrics) {
    metricResults.push(await metric.evaluate(record));
  }
  record.metrics = metricResults;

  const checks: EvalMetricResult[] = [];
  if (definition.check) {
    await definition.check(createEvalCheckContext({
      definition,
      example,
      repetition,
      record,
      checks,
    }));
  }
  record.checks = checks;

  if (isBlockingFailure(record)) {
    record.completed = record.completed && true;
  }

  return record;
}

/** Execute an eval locally with injected target adapters. */
export async function runEval(
  definition: EvalDefinition,
  options: RunEvalOptions,
) {
  const startedAt = options.now?.() ?? new Date();
  const baseDir = options.baseDir ?? Deno.cwd();
  const examples = await definition.dataset.load({ baseDir });
  const records: EvalRecord[] = [];

  for (const example of examples) {
    for (let repetition = 1; repetition <= definition.repetitions; repetition += 1) {
      records.push(await runRecord(definition, options, example, repetition));
    }
  }

  const endedAt = options.now?.() ?? new Date();
  const report = createEvalReport({
    definition,
    records,
    runId: options.runId ?? createRunId(startedAt),
    startedAt,
    endedAt,
    metadata: options.metadata,
  });
  emitEvalRuntimeMetrics(report);
  const exports = await exportEvalReport(report, options.export);
  return exports === undefined ? report : { ...report, exports };
}

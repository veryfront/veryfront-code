import { createEvalCheckContext } from "./expect.ts";
import { isEvalDefinition } from "./factory.ts";
import { createEvalDatasetMetadata, createEvalReport } from "./report.ts";
import { createEvalRunId } from "./run-id.ts";
import { metrics as runtimeMetrics } from "#veryfront/metrics";
import { cwd } from "#veryfront/platform/compat/process.ts";
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
  EvalReport,
  EvalReportExportConfig,
  EvalToolAdapterResult,
  EvalToolCall,
  EvalTrace,
  EvalUsage,
  LocalEvalReport,
  RunEvalOptions,
} from "./types.ts";
import {
  assertFiniteEvalNumber,
  createEvalValidationError,
  isEvalArray,
  isEvalRecord,
  normalizeEvalExamples,
  normalizeEvalString,
  stringifyEvalError,
} from "./validation.ts";

const UNMAPPED_TOOL_INPUT = Symbol("unmapped-tool-input");
const USAGE_NUMERIC_KEYS = [
  "inputTokens",
  "outputTokens",
  "totalTokens",
  "billableInputTokens",
  "billableOutputTokens",
  "cachedInputTokens",
  "cacheCreationInputTokens",
  "cacheReadInputTokens",
  "reasoningTokens",
  "costUsd",
  "providerInputCostUsd",
  "providerOutputCostUsd",
  "providerCostUsd",
  "veryfrontInputChargeUsd",
  "veryfrontOutputChargeUsd",
  "veryfrontChargeUsd",
  "veryfrontBilledUsd",
  "costCredits",
] as const satisfies readonly (keyof EvalUsage)[];

function normalizeTrace(trace?: Partial<EvalTrace>): EvalTrace {
  if (trace !== undefined && !isEvalRecord(trace)) {
    throw createEvalValidationError("Eval adapter trace must be an object");
  }
  if (trace?.events !== undefined && !isEvalArray(trace.events)) {
    throw createEvalValidationError("Eval adapter trace events must be an array");
  }
  if (trace?.toolCalls !== undefined && !isEvalArray(trace.toolCalls)) {
    throw createEvalValidationError("Eval adapter trace toolCalls must be an array");
  }
  return {
    events: [...(trace?.events ?? [])],
    toolCalls: (trace?.toolCalls ?? []).map((toolCall, index) => {
      if (!isEvalRecord(toolCall)) {
        throw createEvalValidationError(
          `Eval adapter trace toolCalls[${index}] must be an object`,
        );
      }
      const name = normalizeEvalString(
        toolCall.name,
        `Eval adapter trace toolCalls[${index}] name`,
      );
      if (
        toolCall.status !== undefined &&
        toolCall.status !== "ok" &&
        toolCall.status !== "error" &&
        toolCall.status !== "skipped" &&
        toolCall.status !== "denied"
      ) {
        throw createEvalValidationError(
          `Eval adapter trace toolCalls[${index}] has an invalid status`,
        );
      }
      return { ...toolCall, name } as EvalToolCall;
    }),
  };
}

function normalizeUsage(usage?: EvalUsage): EvalUsage {
  if (usage === undefined) return {};
  if (!isEvalRecord(usage)) {
    throw createEvalValidationError("Eval adapter usage must be an object");
  }
  const normalized = { ...usage } as EvalUsage;
  for (const key of USAGE_NUMERIC_KEYS) {
    const value = normalized[key];
    if (value !== undefined) {
      assertFiniteEvalNumber(value, `Eval adapter usage ${key}`, { min: 0 });
    }
  }
  return normalized;
}

function normalizeAgentAdapterResult(
  result: string | EvalAgentAdapterResult,
): EvalAgentAdapterResult {
  if (typeof result === "string") return { text: result };
  if (!isEvalRecord(result)) {
    throw createEvalValidationError("Eval agent adapter must return a string or result object");
  }
  validateAdapterResultFields(result, "agent");
  return {
    ...result,
    ...(result.trace === undefined
      ? {}
      : { trace: normalizeTrace(result.trace as Partial<EvalTrace>) }),
    ...(result.usage === undefined ? {} : { usage: normalizeUsage(result.usage as EvalUsage) }),
  };
}

function normalizeToolAdapterResult(result: EvalToolAdapterResult): EvalToolAdapterResult {
  if (!isEvalRecord(result)) {
    throw createEvalValidationError("Eval tool adapter must return a result object");
  }
  validateAdapterResultFields(result, "tool");
  return {
    ...result,
    ...(result.trace === undefined
      ? {}
      : { trace: normalizeTrace(result.trace as Partial<EvalTrace>) }),
    ...(result.usage === undefined ? {} : { usage: normalizeUsage(result.usage as EvalUsage) }),
  } as EvalToolAdapterResult;
}

function validateAdapterResultFields(
  result: Record<string, unknown>,
  kind: "agent" | "tool",
): void {
  if (result.completed !== undefined && typeof result.completed !== "boolean") {
    throw createEvalValidationError(`Eval ${kind} adapter completed must be a boolean`);
  }
  if (result.error !== undefined && typeof result.error !== "string") {
    throw createEvalValidationError(`Eval ${kind} adapter error must be a string`);
  }
  if (result.durationMs !== undefined) {
    assertFiniteEvalNumber(result.durationMs, `Eval ${kind} adapter durationMs`, { min: 0 });
  }
}

function normalizeOutput(result: EvalAgentAdapterResult): unknown {
  if (Object.hasOwn(result, "output")) return result.output;
  if (Object.hasOwn(result, "json")) return { json: result.json };
  if (Object.hasOwn(result, "text")) return { text: result.text };
  return result;
}

function normalizeToolTargetName(target: string): string {
  return target.startsWith("tool:") ? target.slice("tool:".length) : target;
}

function createDirectToolTraceCall(
  definition: EvalDefinition,
  input: unknown,
  result: EvalToolAdapterResult,
): EvalToolCall {
  return {
    ...(result.toolCallId ? { id: result.toolCallId } : {}),
    name: normalizeToolTargetName(definition.target),
    status: result.error || result.completed === false ? "error" : "ok",
    input,
    output: result.output,
    ...(result.error ? { error: result.error } : {}),
    ...(result.durationMs !== undefined ? { metadata: { durationMs: result.durationMs } } : {}),
  };
}

function normalizeToolTrace(
  definition: EvalDefinition,
  input: unknown,
  result: EvalToolAdapterResult,
): EvalTrace {
  const trace = normalizeTrace(result.trace);
  if (trace.toolCalls.length > 0) return trace;
  return {
    ...trace,
    toolCalls: [createDirectToolTraceCall(definition, input, result)],
  };
}

async function runAgentTarget(
  definition: EvalDefinition,
  options: RunEvalOptions,
  example: Awaited<ReturnType<EvalDefinition["dataset"]["load"]>>[number],
  repetition: number,
): Promise<EvalAgentAdapterResult> {
  const adapter = options.adapters.agent;
  if (!adapter) {
    throw new Error(`No agent adapter configured for eval target "${definition.target}".`);
  }
  return normalizeAgentAdapterResult(await adapter({ definition, example, repetition }));
}

async function runToolTarget(
  definition: EvalDefinition,
  options: RunEvalOptions,
  example: Awaited<ReturnType<EvalDefinition["dataset"]["load"]>>[number],
  repetition: number,
  runId: string,
  markInvoked?: () => void,
): Promise<{ input: unknown; result: EvalToolAdapterResult }> {
  const adapter = options.adapters.tool;
  if (!adapter) {
    throw new Error(`No tool adapter configured for eval target "${definition.target}".`);
  }
  const input = definition.input ? await definition.input(example) : example.input;
  markInvoked?.();
  const result = normalizeToolAdapterResult(
    await adapter({ definition, example, repetition, runId, input }),
  );
  return { input, result };
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

function metricEvaluationFailure(
  metric: EvalDefinition["metrics"][number],
  error: unknown,
): EvalMetricResult {
  return {
    name: metric.name,
    family: metric.family,
    severity: metric.severity,
    pass: false,
    explanation: `Metric evaluation failed: ${stringifyEvalError(error)}`,
  };
}

function normalizeMetricResult(
  metric: EvalDefinition["metrics"][number],
  result: unknown,
): EvalMetricResult {
  if (!isEvalRecord(result)) {
    throw createEvalValidationError(`Metric "${metric.name}" must return a result object`);
  }
  if (result.score !== undefined) {
    assertFiniteEvalNumber(result.score, `Metric "${metric.name}" score`);
  }
  if (result.pass !== undefined && typeof result.pass !== "boolean") {
    throw createEvalValidationError(`Metric "${metric.name}" pass must be a boolean`);
  }
  if (result.skipped !== undefined && typeof result.skipped !== "boolean") {
    throw createEvalValidationError(`Metric "${metric.name}" skipped must be a boolean`);
  }
  return {
    ...result,
    name: metric.name,
    family: metric.family,
    severity: metric.severity,
  } as EvalMetricResult;
}

function createExporterFailureResult(
  exporterId: string,
  error: unknown,
): EvalReportExportResult {
  return {
    exporterId,
    ok: false,
    error: stringifyEvalError(error),
  };
}

function createExporterFailureResults(
  exporterIds: string[],
  error: unknown,
): EvalReportExportResult[] {
  const ids = exporterIds.length > 0 ? exporterIds : [EvalReportExporterRegistryName];
  return ids.map((exporterId) => createExporterFailureResult(exporterId, error));
}

function resolveExporterRegistry(
  config: EvalReportExportConfig,
): EvalReportExporterRegistry | undefined {
  return config.registry ??
    tryResolve<EvalReportExporterRegistry>(EvalReportExporterRegistryName);
}

function listRegisteredExporterIds(registry: EvalReportExporterRegistry): string[] {
  try {
    return registry.list().map((exporter) => exporter.id).filter((id) => id.length > 0);
  } catch {
    return [];
  }
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
  report: EvalReport,
  config: EvalReportExportConfig,
  exporterId: string,
): Promise<EvalReportExportResult> {
  try {
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
  } catch (error) {
    return createExporterFailureResult(exporterId, error);
  }
}

/**
 * Export an eval report through the configured eval report exporter registry.
 *
 * Takes the wide {@link EvalReport}, not {@link LocalEvalReport}: exporting is the step that
 * strips the dataset content hash, so it must accept reports that already lack one — a report
 * round-tripped through redaction, or one read back from a sanitized artifact.
 */
export async function exportEvalReport(
  report: EvalReport,
  config?: EvalReportExportConfig,
): Promise<EvalReportExportResult[] | undefined> {
  if (!config) return undefined;

  const exporterIds = config.exporterIds?.filter((id) => id.length > 0) ?? [];
  let registry: EvalReportExporterRegistry | undefined;
  try {
    registry = resolveExporterRegistry(config);
  } catch (error) {
    return createExporterFailureResults(exporterIds, error);
  }
  if (!registry) return createMissingRegistryResults(exporterIds);

  if (exporterIds.length === 0) {
    try {
      return await registry.export(report, withActiveTraceContext(config.context));
    } catch (error) {
      return createExporterFailureResults(listRegisteredExporterIds(registry), error);
    }
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
  runId: string,
): Promise<EvalRecord> {
  const started = Date.now();
  let result: EvalAgentAdapterResult | EvalToolAdapterResult;
  let toolInput: unknown = UNMAPPED_TOOL_INPUT;
  let toolInvoked = false;

  try {
    if (definition.targetKind === "dataset") {
      // Dataset evals grade the stored example value directly: no execution.
      result = { output: example.input, completed: true };
    } else if (definition.targetKind === "tool") {
      const toolRun = await runToolTarget(definition, options, example, repetition, runId, () => {
        toolInvoked = true;
      });
      result = toolRun.result;
      toolInput = toolRun.input;
    } else {
      result = await runAgentTarget(definition, options, example, repetition);
    }
  } catch (error) {
    result = {
      ...(definition.targetKind === "tool" ? { output: undefined } : { text: "" }),
      completed: false,
      error: stringifyEvalError(error),
    };
  }

  const output = definition.targetKind === "tool"
    ? (result as EvalToolAdapterResult).output
    : normalizeOutput(result as EvalAgentAdapterResult);
  const agentResult = definition.targetKind === "agent"
    ? result as EvalAgentAdapterResult
    : undefined;
  const record: EvalRecord = {
    id: `${example.id}:${repetition}`,
    evalId: definition.id,
    exampleId: example.id,
    repetition,
    input: example.input,
    ...(definition.targetKind === "tool" && toolInvoked
      ? { executionInput: toolInput === UNMAPPED_TOOL_INPUT ? example.input : toolInput }
      : {}),
    output,
    ...(Object.hasOwn(example, "reference") ? { reference: example.reference } : {}),
    metadata: example.metadata ?? {},
    ...(agentResult?.retrievedContext ? { retrievedContext: agentResult.retrievedContext } : {}),
    ...(agentResult?.citations ? { citations: agentResult.citations } : {}),
    trace: definition.targetKind === "tool"
      ? (toolInvoked
        ? normalizeToolTrace(
          definition,
          toolInput === UNMAPPED_TOOL_INPUT ? example.input : toolInput,
          result as EvalToolAdapterResult,
        )
        : normalizeTrace((result as EvalToolAdapterResult).trace))
      : normalizeTrace(result.trace),
    usage: normalizeUsage(result.usage),
    durationMs: result.durationMs ?? Date.now() - started,
    completed: result.completed ?? !result.error,
    ...(result.error ? { error: result.error } : {}),
  };

  const metricResults = [];
  const evaluationErrors: string[] = [];
  for (const metric of definition.metrics) {
    try {
      metricResults.push(normalizeMetricResult(metric, await metric.evaluate(record)));
    } catch (error) {
      const failure = metricEvaluationFailure(metric, error);
      metricResults.push(failure);
      evaluationErrors.push(failure.explanation ?? `${metric.name} evaluation failed`);
    }
  }
  record.metrics = metricResults;

  const checks: EvalMetricResult[] = [];
  if (definition.check) {
    try {
      await definition.check(createEvalCheckContext({
        definition,
        example,
        repetition,
        record,
        checks,
      }));
    } catch (error) {
      evaluationErrors.push(`Eval check failed: ${stringifyEvalError(error)}`);
    }
  }
  record.checks = checks;

  if (evaluationErrors.length > 0) {
    record.error = [record.error, ...evaluationErrors].filter(Boolean).join("; ");
    record.completed = false;
  } else if (isBlockingFailure(record)) {
    record.completed = false;
  }

  return record;
}

/** Execute an eval locally with injected target adapters. */
export async function runEval(
  definition: EvalDefinition,
  options: RunEvalOptions,
): Promise<LocalEvalReport> {
  if (!isEvalDefinition(definition)) {
    throw createEvalValidationError("runEval requires a valid eval definition");
  }
  const startedAt = options.now?.() ?? new Date();
  if (!(startedAt instanceof Date) || !Number.isFinite(startedAt.getTime())) {
    throw createEvalValidationError("Eval start time must be a valid Date");
  }
  const runId = options.runId === undefined
    ? createEvalRunId(startedAt)
    : normalizeEvalString(options.runId, "Eval run id");
  const baseDir = options.baseDir ?? cwd();
  const loadedExamples = await definition.dataset.load({ baseDir });
  const examples = normalizeEvalExamples(
    loadedExamples,
    `dataset "${definition.dataset.path ?? definition.dataset.kind}"`,
  );
  const dataset = await createEvalDatasetMetadata(definition.dataset, examples);
  const records: EvalRecord[] = [];

  for (const example of examples) {
    for (let repetition = 1; repetition <= definition.repetitions; repetition += 1) {
      records.push(await runRecord(definition, options, example, repetition, runId));
    }
  }

  const endedAt = options.now?.() ?? new Date();
  if (!(endedAt instanceof Date) || !Number.isFinite(endedAt.getTime())) {
    throw createEvalValidationError("Eval end time must be a valid Date");
  }
  const report = createEvalReport({
    definition,
    records,
    runId,
    startedAt,
    endedAt,
    dataset,
    metadata: options.metadata,
  });
  emitEvalRuntimeMetrics(report);
  const exports = await exportEvalReport(report, options.export);
  return exports === undefined ? report : { ...report, exports };
}

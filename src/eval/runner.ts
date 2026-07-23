import { createEvalCheckContext } from "./expect.ts";
import { isEvalDefinition } from "./factory.ts";
import { createEvalDatasetMetadata, createEvalReport } from "./report.ts";
import { assertValidEvalDate, assertValidEvalRunId, createEvalRunId } from "./run-id.ts";
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
  EvalMetric,
  EvalMetricResult,
  EvalRecord,
  EvalReportExportConfig,
  EvalToolAdapterResult,
  EvalToolCall,
  EvalTrace,
  EvalUsage,
  RunEvalOptions,
} from "./types.ts";
import {
  createEvalValidationError,
  formatEvalPublicError,
  normalizeEvalExamples,
} from "./validation.ts";
import { canonicalJsonStringify } from "./canonical-json.ts";

const UNMAPPED_TOOL_INPUT = Symbol("unmapped-tool-input");
const MAX_EVAL_RECORDS = 100_000;
const MAX_EVAL_ADAPTER_RESULT_BYTES = 16 * 1024 * 1024;
const MAX_EVAL_METRIC_RESULT_BYTES = 1024 * 1024;
const MAX_EVAL_TRACE_ITEMS = 100_000;
const MAX_EVAL_CONTEXT_ITEMS = 10_000;
const MAX_EVAL_EXPORTERS = 256;
const MAX_EVAL_TEXT_LENGTH = 16_384;
const MAX_EVAL_BASE_DIR_LENGTH = 4_096;
const EXPORTER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const EVAL_METRIC_FAMILIES = new Set(["answer", "agent", "ops", "judge", "knowledge", "check"]);
const EVAL_SEVERITIES = new Set(["gate", "soft", "budget"]);
const USAGE_TOKEN_KEYS = [
  "inputTokens",
  "outputTokens",
  "totalTokens",
  "billableInputTokens",
  "billableOutputTokens",
  "cachedInputTokens",
  "cacheCreationInputTokens",
  "cacheReadInputTokens",
  "reasoningTokens",
] as const satisfies ReadonlyArray<keyof EvalUsage>;
const USAGE_COST_KEYS = [
  "costUsd",
  "providerInputCostUsd",
  "providerOutputCostUsd",
  "providerCostUsd",
  "veryfrontInputChargeUsd",
  "veryfrontOutputChargeUsd",
  "veryfrontChargeUsd",
  "veryfrontBilledUsd",
  "costCredits",
] as const satisfies ReadonlyArray<keyof EvalUsage>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertValidRunOptions(value: unknown): asserts value is RunEvalOptions {
  if (!isRecord(value) || !isRecord(value.adapters)) {
    throw createEvalValidationError("Eval run options and adapters must be objects");
  }
  for (const key of ["agent", "tool"] as const) {
    const adapter = value.adapters[key];
    if (adapter !== undefined && typeof adapter !== "function") {
      throw createEvalValidationError(`Eval ${key} adapter must be a function when provided`);
    }
  }
  if (
    value.baseDir !== undefined &&
    (typeof value.baseDir !== "string" || value.baseDir.trim().length === 0 ||
      value.baseDir.length > MAX_EVAL_BASE_DIR_LENGTH || value.baseDir.includes("\0"))
  ) {
    throw createEvalValidationError(
      `Eval baseDir must be a non-empty string of at most ${MAX_EVAL_BASE_DIR_LENGTH} characters`,
    );
  }
  if (value.now !== undefined && typeof value.now !== "function") {
    throw createEvalValidationError("Eval now option must be a function when provided");
  }
  if (value.runId !== undefined) assertValidEvalRunId(value.runId);
  if (value.metadata !== undefined && !isRecord(value.metadata)) {
    throw createEvalValidationError("Eval report metadata must be an object when provided");
  }
  if (value.export !== undefined && !isRecord(value.export)) {
    throw createEvalValidationError("Eval report export configuration must be an object");
  }
}

function assertBoundedOptionalText(value: unknown, label: string): void {
  if (value === undefined) return;
  if (typeof value !== "string" || value.length > MAX_EVAL_TEXT_LENGTH) {
    throw createEvalValidationError(
      `${label} must be a string of at most ${MAX_EVAL_TEXT_LENGTH} characters`,
    );
  }
}

function normalizeMetricResult(result: unknown, metric: EvalMetric): EvalMetricResult {
  if (!isRecord(result)) {
    throw createEvalValidationError(`Eval metric "${metric.name}" must return an object`);
  }
  if (
    result.name !== metric.name || result.family !== metric.family ||
    result.severity !== metric.severity
  ) {
    throw createEvalValidationError(
      `Eval metric "${metric.name}" result identity must match its definition`,
    );
  }
  if (!EVAL_METRIC_FAMILIES.has(result.family as string)) {
    throw createEvalValidationError(`Eval metric "${metric.name}" result family is invalid`);
  }
  if (!EVAL_SEVERITIES.has(result.severity as string)) {
    throw createEvalValidationError(`Eval metric "${metric.name}" result severity is invalid`);
  }
  const score = result.score;
  const pass = result.pass;
  const skipped = result.skipped;
  const label = result.label;
  const explanation = result.explanation;
  const evidence = result.evidence;
  if (score !== undefined && (typeof score !== "number" || !Number.isFinite(score))) {
    throw createEvalValidationError(`Eval metric "${metric.name}" score must be finite`);
  }
  for (const [key, value] of [["pass", pass], ["skipped", skipped]] as const) {
    if (value !== undefined && typeof value !== "boolean") {
      throw createEvalValidationError(`Eval metric "${metric.name}" ${key} must be a boolean`);
    }
  }
  assertBoundedOptionalText(label, `Eval metric "${metric.name}" label`);
  assertBoundedOptionalText(explanation, `Eval metric "${metric.name}" explanation`);
  if (evidence !== undefined && !isRecord(evidence)) {
    throw createEvalValidationError(`Eval metric "${metric.name}" evidence must be an object`);
  }

  let serialized: string | undefined;
  try {
    serialized = canonicalJsonStringify(result);
  } catch {
    throw createEvalValidationError(
      `Eval metric "${metric.name}" result must be JSON-serializable`,
    );
  }
  if (
    serialized === undefined ||
    new TextEncoder().encode(serialized).byteLength > MAX_EVAL_METRIC_RESULT_BYTES
  ) {
    throw createEvalValidationError(
      `Eval metric "${metric.name}" result exceeds the ${MAX_EVAL_METRIC_RESULT_BYTES}-byte limit`,
    );
  }
  return {
    name: metric.name,
    family: metric.family,
    severity: metric.severity,
    ...(typeof score === "number" ? { score } : {}),
    ...(typeof pass === "boolean" ? { pass } : {}),
    ...(typeof skipped === "boolean" ? { skipped } : {}),
    ...(typeof label === "string" ? { label } : {}),
    ...(typeof explanation === "string" ? { explanation } : {}),
    ...(isRecord(evidence) ? { evidence } : {}),
  };
}

function assertValidUsage(usage: EvalUsage | undefined): void {
  if (usage === undefined) return;
  if (!isRecord(usage)) {
    throw createEvalValidationError("Eval adapter usage must be an object");
  }
  for (const key of USAGE_TOKEN_KEYS) {
    const value = usage[key];
    if (
      value !== undefined &&
      (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    ) {
      throw createEvalValidationError(`Eval adapter usage.${key} must be a non-negative integer`);
    }
  }
  for (const key of USAGE_COST_KEYS) {
    const value = usage[key];
    if (
      value !== undefined && (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    ) {
      throw createEvalValidationError(
        `Eval adapter usage.${key} must be a finite non-negative number`,
      );
    }
  }
}

function assertValidAdapterResult(
  result: unknown,
  targetKind: EvalDefinition["targetKind"],
): asserts result is EvalAgentAdapterResult | EvalToolAdapterResult {
  if (!isRecord(result)) {
    throw createEvalValidationError(`Eval ${targetKind} adapter must return an object`);
  }
  if (targetKind === "tool" && !Object.hasOwn(result, "output")) {
    throw createEvalValidationError("Eval tool adapter result output is required");
  }
  if (
    result.durationMs !== undefined &&
    (typeof result.durationMs !== "number" || !Number.isFinite(result.durationMs) ||
      result.durationMs < 0)
  ) {
    throw createEvalValidationError(
      "Eval adapter durationMs must be a finite non-negative number",
    );
  }
  if (result.completed !== undefined && typeof result.completed !== "boolean") {
    throw createEvalValidationError("Eval adapter completed must be a boolean");
  }
  if (result.error !== undefined && typeof result.error !== "string") {
    throw createEvalValidationError("Eval adapter error must be a string");
  }
  if (result.trace !== undefined) {
    if (!isRecord(result.trace)) {
      throw createEvalValidationError("Eval adapter trace must be an object");
    }
    for (const key of ["events", "toolCalls"] as const) {
      const entries = result.trace[key];
      if (entries !== undefined && !Array.isArray(entries)) {
        throw createEvalValidationError(`Eval adapter trace.${key} must be an array`);
      }
      if (Array.isArray(entries) && entries.length > MAX_EVAL_TRACE_ITEMS) {
        throw createEvalValidationError(
          `Eval adapter trace.${key} must not exceed ${MAX_EVAL_TRACE_ITEMS} entries`,
        );
      }
    }
  }
  for (const key of ["retrievedContext", "citations"] as const) {
    const entries = result[key];
    if (entries !== undefined && !Array.isArray(entries)) {
      throw createEvalValidationError(`Eval adapter ${key} must be an array`);
    }
    if (Array.isArray(entries) && entries.length > MAX_EVAL_CONTEXT_ITEMS) {
      throw createEvalValidationError(
        `Eval adapter ${key} must not exceed ${MAX_EVAL_CONTEXT_ITEMS} entries`,
      );
    }
  }
  assertValidUsage(result.usage as EvalUsage | undefined);
  let serialized: string | undefined;
  try {
    serialized = canonicalJsonStringify(result);
  } catch {
    throw createEvalValidationError("Eval adapter result must be JSON-serializable");
  }
  if (
    serialized === undefined ||
    new TextEncoder().encode(serialized).byteLength > MAX_EVAL_ADAPTER_RESULT_BYTES
  ) {
    throw createEvalValidationError(
      `Eval adapter result exceeds the ${MAX_EVAL_ADAPTER_RESULT_BYTES}-byte limit`,
    );
  }
}

function errorMessage(error: unknown): string {
  return formatEvalPublicError(error);
}

function normalizeExporterIds(exporterIds: string[] | undefined): string[] {
  if (exporterIds === undefined) return [];
  if (!Array.isArray(exporterIds) || exporterIds.length > MAX_EVAL_EXPORTERS) {
    throw createEvalValidationError(
      `Eval report export must select at most ${MAX_EVAL_EXPORTERS} exporter ids`,
    );
  }
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const id of exporterIds) {
    if (typeof id !== "string" || !EXPORTER_ID_PATTERN.test(id)) {
      throw createEvalValidationError("Eval report exporter id is invalid");
    }
    if (seen.has(id)) {
      throw createEvalValidationError(`Duplicate eval report exporter id "${id}"`);
    }
    seen.add(id);
    normalized.push(id);
  }
  return normalized;
}

function sanitizeExportResults(results: EvalReportExportResult[]): EvalReportExportResult[] {
  return results.map((result) =>
    result.ok ? result : {
      ...result,
      error: formatEvalPublicError(result.error ?? "Eval report export failed."),
    }
  );
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
    ...(result.error ? { error: errorMessage(result.error) } : {}),
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
  const result = normalizeAdapterResult(await adapter({ definition, example, repetition }));
  assertValidAdapterResult(result, "agent");
  return result as EvalAgentAdapterResult;
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
  const result = await adapter({ definition, example, repetition, runId, input });
  assertValidAdapterResult(result, "tool");
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
  const ids = exporterIds.length > 0 ? exporterIds : [EvalReportExporterRegistryName];
  return ids.map((exporterId) => ({
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

function createExporterFailureResult(
  exporterId: string,
  error: unknown,
): EvalReportExportResult {
  return {
    exporterId,
    ok: false,
    error: formatEvalPublicError(error),
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
  report: ReturnType<typeof createEvalReport>,
  config: EvalReportExportConfig,
  exporterId: string,
): Promise<EvalReportExportResult> {
  try {
    const exporter = registry.get(exporterId);
    if (!exporter) return createMissingExporterResult(exporterId);

    const selectedRegistry = createEvalReportExporterRegistry();
    selectedRegistry.register(exporter);
    const [result] = await selectedRegistry.export(report, withActiveTraceContext(config.context));
    return result ? sanitizeExportResults([result])[0]! : {
      exporterId,
      ok: false,
      error: `EvalReportExporter "${exporterId}" did not return an export result.`,
    };
  } catch (error) {
    return createExporterFailureResult(exporterId, error);
  }
}

/** Export an eval report through the configured eval report exporter registry. */
export async function exportEvalReport(
  report: ReturnType<typeof createEvalReport>,
  config?: EvalReportExportConfig,
): Promise<EvalReportExportResult[] | undefined> {
  if (!config) return undefined;

  const exporterIds = normalizeExporterIds(config.exporterIds);
  let registry: EvalReportExporterRegistry | undefined;
  try {
    registry = resolveExporterRegistry(config);
  } catch (error) {
    return createExporterFailureResults(exporterIds, error);
  }
  if (!registry) return createMissingRegistryResults(exporterIds);

  if (exporterIds.length === 0) {
    try {
      return sanitizeExportResults(
        await registry.export(report, withActiveTraceContext(config.context)),
      );
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
    if (definition.targetKind === "tool") {
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
      error: errorMessage(error),
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
    durationMs: result.durationMs ?? Math.max(0, Date.now() - started),
    completed: result.completed ?? !result.error,
    ...(result.error ? { error: errorMessage(result.error) } : {}),
  };

  const metricResults: EvalMetricResult[] = [];
  for (const metric of definition.metrics) {
    try {
      metricResults.push(normalizeMetricResult(await metric.evaluate(record), metric));
    } catch (error) {
      metricResults.push({
        name: metric.name,
        family: metric.family,
        severity: metric.severity,
        pass: false,
        explanation: `Metric evaluation failed: ${errorMessage(error)}`,
      });
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
      record.completed = false;
      record.error = `Eval check failed: ${errorMessage(error)}`;
    }
  }
  record.checks = checks;

  if (isBlockingFailure(record)) {
    record.completed = false;
  }

  return record;
}

/** Execute an eval locally with injected target adapters. */
export async function runEval(
  definition: EvalDefinition,
  options: RunEvalOptions,
) {
  if (!isEvalDefinition(definition)) {
    throw createEvalValidationError("Eval definition is invalid");
  }
  assertValidRunOptions(options);
  const startedAt = options.now?.() ?? new Date();
  assertValidEvalDate(startedAt);
  const runId = options.runId ?? createEvalRunId(startedAt);
  assertValidEvalRunId(runId);
  const baseDir = options.baseDir ?? Deno.cwd();
  const loadedExamples = await definition.dataset.load({ baseDir });
  const examples = normalizeEvalExamples(loadedExamples, "eval dataset loader result");
  const repetitions = definition.repetitions;
  const recordCount = examples.length * repetitions;
  if (!Number.isSafeInteger(recordCount) || recordCount > MAX_EVAL_RECORDS) {
    throw createEvalValidationError(
      `Eval execution must not exceed the ${MAX_EVAL_RECORDS}-record limit`,
    );
  }
  const dataset = await createEvalDatasetMetadata(definition.dataset, examples);
  const records: EvalRecord[] = [];

  for (const example of examples) {
    for (let repetition = 1; repetition <= repetitions; repetition += 1) {
      records.push(await runRecord(definition, options, example, repetition, runId));
    }
  }

  const endedAt = options.now?.() ?? new Date();
  assertValidEvalDate(endedAt);
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

/**
 * Eval report export redaction and context snapshotting.
 *
 * @module extensions/eval/eval-report-redaction
 */

import type { EvalMetricResult, EvalRecord, EvalReport } from "#veryfront/eval/types.ts";
import {
  EXTENSION_VALIDATION_ERROR,
  isVeryfrontErrorWithSlug,
} from "#veryfront/extensions/errors.ts";
import { identifierIssue } from "#veryfront/extensions/identifiers.ts";
import {
  type EvalReportExportContext,
  type EvalReportExportRedaction,
  type EvalReportExportTraceContext,
  EvalReportRedactedValue,
} from "./eval-report-exporter-contract.ts";

const MAX_METADATA_ALLOWLIST_KEYS = 128;
const MAX_METADATA_KEY_LENGTH = 128;
const MAX_CONTEXT_ID_LENGTH = 256;
const MAX_CONTEXT_PATH_LENGTH = 4096;
const MAX_CONTEXT_TAGS = 128;
const MAX_CONTEXT_TAG_LENGTH = 256;
const REDACTION_BOOLEAN_KEYS = [
  "includeInputs",
  "includeOutputs",
  "includeReferences",
  "includeTraces",
  "includeRetrievedContext",
  "includeCitations",
  "includeMetricExplanations",
  "includeMetricEvidence",
  "includeDatasetPath",
  "includeContextPaths",
  "includeErrors",
] as const satisfies readonly (keyof EvalReportExportRedaction)[];
const EXPORT_CONTEXT_KEYS = [
  "projectId",
  "projectReference",
  "evalId",
  "sourcePath",
  "reportPath",
  "environment",
  "branch",
  "commitSha",
  "runUrl",
  "tags",
  "metadata",
  "trace",
  "redaction",
] as const satisfies readonly (keyof EvalReportExportContext)[];
const EXPORT_CONTEXT_ID_KEYS = [
  "projectId",
  "projectReference",
  "evalId",
  "environment",
  "branch",
  "commitSha",
] as const satisfies readonly (keyof EvalReportExportContext)[];
const REPORT_PUBLIC_KEYS = [
  "kind",
  "schemaVersion",
  "runId",
  "definitionId",
  "targetKind",
  "target",
  "startedAt",
  "endedAt",
] as const satisfies readonly (keyof EvalReport)[];
const RECORD_PUBLIC_KEYS = [
  "id",
  "evalId",
  "exampleId",
  "repetition",
  "durationMs",
  "completed",
] as const satisfies readonly (keyof EvalRecord)[];
const METRIC_PUBLIC_KEYS = [
  "name",
  "family",
  "severity",
  "score",
  "pass",
  "skipped",
  "label",
] as const satisfies readonly (keyof EvalMetricResult)[];
const SUMMARY_PUBLIC_KEYS = [
  "records",
  "passed",
  "failed",
  "passRate",
  "skippedResults",
] as const satisfies readonly (keyof EvalReport["summary"])[];
const SUMMARY_METRIC_PUBLIC_KEYS = [
  "name",
  "family",
  "severity",
  "passed",
  "failed",
  "skipped",
  "passRate",
] as const satisfies readonly (keyof EvalReport["summary"]["metrics"][number])[];
const USAGE_PUBLIC_KEYS = [
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
  "costSource",
  "billingMode",
  "usageCaptureStatus",
] as const satisfies readonly (keyof EvalRecord["usage"])[];
const DURATION_PUBLIC_KEYS = [
  "totalMs",
  "minMs",
  "maxMs",
  "meanMs",
  "p50Ms",
  "p95Ms",
] as const satisfies readonly (
  keyof NonNullable<EvalReport["summary"]["duration"]>
)[];
const FAILED_EXAMPLE_PUBLIC_KEYS = [
  "exampleId",
  "records",
  "passed",
  "failed",
  "passRate",
  "flaky",
] as const satisfies readonly (
  keyof NonNullable<EvalReport["summary"]["failedExamples"]>[number]
)[];
const FLAKE_PUBLIC_KEYS = [
  "examples",
  "stablePassed",
  "stableFailed",
  "flaky",
] as const satisfies readonly (
  keyof NonNullable<EvalReport["summary"]["flakes"]>
)[];
const GATE_FAILURE_PUBLIC_KEYS = [
  "recordId",
  "exampleId",
  "repetition",
  "name",
  "family",
  "severity",
] as const satisfies readonly (
  keyof NonNullable<EvalReport["summary"]["gateFailures"]>[number]
)[];
const DATASET_PUBLIC_KEYS = [
  "kind",
  "examples",
  "hash",
] as const satisfies readonly (keyof NonNullable<EvalReport["dataset"]>)[];

function copyKnownFields<
  T extends object,
  const K extends readonly (keyof T)[],
>(value: T, keys: K): Pick<T, K[number]> {
  const result: Record<PropertyKey, unknown> = {};
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) continue;
    Object.defineProperty(result, key, {
      configurable: true,
      enumerable: true,
      value: Reflect.get(value, key),
      writable: true,
    });
  }
  return result as Pick<T, K[number]>;
}

function filterMetadata(
  metadata: Record<string, unknown>,
  allowlist: string[] | undefined,
): Record<string, unknown> {
  if (!allowlist || allowlist.length === 0) return {};
  const filtered: Record<string, unknown> = {};
  for (const key of allowlist) {
    if (!Object.hasOwn(metadata, key)) continue;
    Object.defineProperty(filtered, key, {
      configurable: true,
      enumerable: true,
      value: metadata[key],
      writable: true,
    });
  }
  return filtered;
}

function redactRecord(
  record: EvalRecord,
  redaction: EvalReportExportRedaction,
): EvalRecord {
  const redacted: EvalRecord = {
    ...copyKnownFields(record, RECORD_PUBLIC_KEYS),
    usage: copyKnownFields(record.usage, USAGE_PUBLIC_KEYS),
    input: redaction.includeInputs ? record.input : EvalReportRedactedValue,
    ...(Object.hasOwn(record, "executionInput")
      ? {
        executionInput: redaction.includeInputs ? record.executionInput : EvalReportRedactedValue,
      }
      : {}),
    output: redaction.includeOutputs ? record.output : EvalReportRedactedValue,
    metadata: filterMetadata(record.metadata, redaction.metadataAllowlist),
    trace: redaction.includeTraces ? record.trace : { events: [], toolCalls: [] },
    ...(record.metrics ? { metrics: redactMetricResults(record.metrics, redaction) } : {}),
    ...(record.checks ? { checks: redactMetricResults(record.checks, redaction) } : {}),
  };

  if (Object.hasOwn(record, "reference")) {
    redacted.reference = redaction.includeReferences ? record.reference : EvalReportRedactedValue;
  }
  if (Object.hasOwn(record, "retrievedContext")) {
    redacted.retrievedContext = redaction.includeRetrievedContext ? record.retrievedContext : [];
  }
  if (Object.hasOwn(record, "citations")) {
    redacted.citations = redaction.includeCitations ? record.citations : [];
  }
  if (Object.hasOwn(record, "error")) {
    redacted.error = redaction.includeErrors ? record.error : EvalReportRedactedValue;
  }

  return redacted;
}

function redactMetricResults(
  results: EvalMetricResult[],
  redaction: EvalReportExportRedaction,
): EvalMetricResult[] {
  return results.map((result) => {
    const redacted: EvalMetricResult = copyKnownFields(result, METRIC_PUBLIC_KEYS);
    if (redaction.includeMetricExplanations && Object.hasOwn(result, "explanation")) {
      redacted.explanation = result.explanation;
    }
    if (redaction.includeMetricEvidence && Object.hasOwn(result, "evidence")) {
      redacted.evidence = result.evidence;
    }
    return redacted;
  });
}

/** @internal Validate and copy an export redaction policy. */
export function normalizeRedaction(
  redaction: EvalReportExportRedaction | undefined,
): EvalReportExportRedaction | undefined {
  if (redaction === undefined) return undefined;
  let isArray: boolean;
  try {
    isArray = Array.isArray(redaction);
  } catch {
    throw EXTENSION_VALIDATION_ERROR.create({
      message: "Eval report export redaction properties must be readable",
    });
  }
  if (typeof redaction !== "object" || redaction === null || isArray) {
    throw EXTENSION_VALIDATION_ERROR.create({
      message: "Eval report export redaction must be an object",
    });
  }

  const normalized: EvalReportExportRedaction = {};
  const booleanValues = new Map<
    (typeof REDACTION_BOOLEAN_KEYS)[number],
    unknown
  >();
  let metadataAllowlist: unknown;
  try {
    for (const key of REDACTION_BOOLEAN_KEYS) booleanValues.set(key, redaction[key]);
    metadataAllowlist = redaction.metadataAllowlist;
  } catch {
    throw EXTENSION_VALIDATION_ERROR.create({
      message: "Eval report export redaction properties must be readable",
    });
  }

  for (const [key, value] of booleanValues) {
    if (value === undefined) continue;
    if (typeof value !== "boolean") {
      throw EXTENSION_VALIDATION_ERROR.create({
        message: `Eval report export redaction ${key} must be a boolean`,
      });
    }
    normalized[key] = value;
  }

  if (metadataAllowlist === undefined) return normalized;
  let allowlistLength: unknown;
  try {
    if (!Array.isArray(metadataAllowlist)) throw new TypeError();
    allowlistLength = Reflect.get(metadataAllowlist, "length");
  } catch {
    throw EXTENSION_VALIDATION_ERROR.create({
      message:
        `Eval report export redaction metadataAllowlist must contain at most ${MAX_METADATA_ALLOWLIST_KEYS} keys`,
    });
  }
  if (
    typeof allowlistLength !== "number" || !Number.isSafeInteger(allowlistLength) ||
    allowlistLength < 0 || allowlistLength > MAX_METADATA_ALLOWLIST_KEYS
  ) {
    throw EXTENSION_VALIDATION_ERROR.create({
      message:
        `Eval report export redaction metadataAllowlist must contain at most ${MAX_METADATA_ALLOWLIST_KEYS} keys`,
    });
  }
  const allowlist: string[] = [];
  for (let index = 0; index < allowlistLength; index++) {
    let key: unknown;
    try {
      key = Reflect.get(metadataAllowlist, index);
    } catch {
      throw EXTENSION_VALIDATION_ERROR.create({
        message: "Eval report export redaction metadataAllowlist properties must be readable",
      });
    }
    const issue = identifierIssue(key, MAX_METADATA_KEY_LENGTH);
    if (issue) {
      throw EXTENSION_VALIDATION_ERROR.create({
        message: `Eval report export metadata allowlist key ${issue}`,
      });
    }
    allowlist.push(key as string);
  }
  normalized.metadataAllowlist = [...new Set(allowlist)];
  return normalized;
}

function redactReportSummary(
  summary: EvalReport["summary"],
  redaction: EvalReportExportRedaction,
): EvalReport["summary"] {
  return {
    ...copyKnownFields(summary, SUMMARY_PUBLIC_KEYS),
    metrics: summary.metrics.map((metric) => copyKnownFields(metric, SUMMARY_METRIC_PUBLIC_KEYS)),
    ...(summary.duration
      ? { duration: copyKnownFields(summary.duration, DURATION_PUBLIC_KEYS) }
      : {}),
    ...(summary.usage ? { usage: copyKnownFields(summary.usage, USAGE_PUBLIC_KEYS) } : {}),
    ...(summary.failedExamples
      ? {
        failedExamples: summary.failedExamples.map((example) =>
          copyKnownFields(example, FAILED_EXAMPLE_PUBLIC_KEYS)
        ),
      }
      : {}),
    ...(summary.flakes ? { flakes: copyKnownFields(summary.flakes, FLAKE_PUBLIC_KEYS) } : {}),
    ...(summary.gateFailures
      ? {
        gateFailures: summary.gateFailures.map((failure) => {
          const redactedFailure = copyKnownFields(
            failure,
            GATE_FAILURE_PUBLIC_KEYS,
          ) as typeof failure;
          const includeExplanation = failure.name === "record.error"
            ? redaction.includeErrors
            : redaction.includeMetricExplanations;
          if (includeExplanation && Object.hasOwn(failure, "explanation")) {
            redactedFailure.explanation = failure.explanation;
          }
          if (redaction.includeMetricEvidence && Object.hasOwn(failure, "evidence")) {
            redactedFailure.evidence = failure.evidence;
          }
          return redactedFailure;
        }),
      }
      : {}),
  };
}

function redactReportMetadata(
  metadata: EvalReport["metadata"],
  redaction: EvalReportExportRedaction,
): EvalReport["metadata"] {
  if (!metadata) return undefined;
  const filtered = filterMetadata(
    metadata as Record<string, unknown>,
    redaction.metadataAllowlist,
  );
  return Object.keys(filtered).length > 0 ? filtered as EvalReport["metadata"] : undefined;
}

function redactDatasetMetadata(
  dataset: EvalReport["dataset"],
  redaction: EvalReportExportRedaction,
): EvalReport["dataset"] {
  if (!dataset) return dataset;
  return {
    ...copyKnownFields(dataset, DATASET_PUBLIC_KEYS),
    ...(redaction.includeDatasetPath && Object.hasOwn(dataset, "path")
      ? { path: dataset.path }
      : {}),
  };
}

function assertContextString(
  key: string,
  value: unknown,
  maximumLength: number,
): asserts value is string {
  const issue = identifierIssue(value, maximumLength);
  if (issue) {
    throw EXTENSION_VALIDATION_ERROR.create({
      message: `Eval report export context ${key} ${issue}`,
    });
  }
}

function snapshotTraceContext(trace: unknown): EvalReportExportTraceContext {
  if (typeof trace !== "object" || trace === null || Array.isArray(trace)) {
    throw EXTENSION_VALIDATION_ERROR.create({
      message: "Eval report export trace context must be an object",
    });
  }
  const snapshot: EvalReportExportTraceContext = {};
  for (const key of ["traceId", "spanId", "parentSpanId"] as const) {
    let value: unknown;
    try {
      value = (trace as Record<string, unknown>)[key];
    } catch {
      throw EXTENSION_VALIDATION_ERROR.create({
        message: "Eval report export trace context properties must be readable",
      });
    }
    if (value === undefined) continue;
    assertContextString(`trace.${key}`, value, MAX_CONTEXT_ID_LENGTH);
    snapshot[key] = value;
  }
  return snapshot;
}

/** @internal Read each supported context field once and reject malformed values. */
export function snapshotEvalReportExportContext(
  context: EvalReportExportContext,
): EvalReportExportContext {
  if (typeof context !== "object" || context === null || Array.isArray(context)) {
    throw EXTENSION_VALIDATION_ERROR.create({
      message: "Eval report export context must be an object",
    });
  }
  const snapshot: EvalReportExportContext = {};
  try {
    for (const key of EXPORT_CONTEXT_KEYS) {
      const value = context[key];
      if (value !== undefined) (snapshot as Record<string, unknown>)[key] = value;
    }
  } catch {
    throw EXTENSION_VALIDATION_ERROR.create({
      message: "Eval report export context properties must be readable",
    });
  }

  for (const key of EXPORT_CONTEXT_ID_KEYS) {
    const value = snapshot[key];
    if (value !== undefined) assertContextString(key, value, MAX_CONTEXT_ID_LENGTH);
  }
  if (snapshot.sourcePath !== undefined) {
    assertContextString("sourcePath", snapshot.sourcePath, MAX_CONTEXT_PATH_LENGTH);
  }
  if (snapshot.reportPath !== undefined) {
    assertContextString("reportPath", snapshot.reportPath, MAX_CONTEXT_PATH_LENGTH);
  }
  if (snapshot.runUrl !== undefined) {
    assertContextString("runUrl", snapshot.runUrl, MAX_CONTEXT_PATH_LENGTH);
  }
  if (snapshot.tags !== undefined) {
    let tagCount: unknown;
    try {
      if (!Array.isArray(snapshot.tags)) throw new TypeError();
      tagCount = Reflect.get(snapshot.tags, "length");
    } catch {
      throw EXTENSION_VALIDATION_ERROR.create({
        message: `Eval report export context tags must contain at most ${MAX_CONTEXT_TAGS} strings`,
      });
    }
    if (
      typeof tagCount !== "number" || !Number.isSafeInteger(tagCount) || tagCount < 0 ||
      tagCount > MAX_CONTEXT_TAGS
    ) {
      throw EXTENSION_VALIDATION_ERROR.create({
        message: `Eval report export context tags must contain at most ${MAX_CONTEXT_TAGS} strings`,
      });
    }
    const tags: string[] = [];
    for (let index = 0; index < tagCount; index++) {
      let tag: unknown;
      try {
        tag = Reflect.get(snapshot.tags, index);
      } catch {
        throw EXTENSION_VALIDATION_ERROR.create({
          message: "Eval report export context tag properties must be readable",
        });
      }
      const issue = identifierIssue(tag, MAX_CONTEXT_TAG_LENGTH);
      if (issue) {
        throw EXTENSION_VALIDATION_ERROR.create({
          message: `Eval report export context tag ${issue}`,
        });
      }
      tags.push(tag as string);
    }
    snapshot.tags = tags;
  }
  if (
    snapshot.metadata !== undefined &&
    (typeof snapshot.metadata !== "object" || snapshot.metadata === null ||
      Array.isArray(snapshot.metadata))
  ) {
    throw EXTENSION_VALIDATION_ERROR.create({
      message: "Eval report export context metadata must be an object",
    });
  }
  if (snapshot.trace !== undefined) snapshot.trace = snapshotTraceContext(snapshot.trace);
  return snapshot;
}

/** @internal Apply metadata and path redaction to a validated context snapshot. */
export function redactEvalReportExportContext(
  context: EvalReportExportContext,
  redaction: EvalReportExportRedaction,
): EvalReportExportContext {
  const {
    metadata,
    redaction: contextRedaction,
    reportPath,
    sourcePath,
    tags,
    trace,
    ...contextFields
  } = context;
  const exportContext: EvalReportExportContext = {
    ...contextFields,
    ...(redaction.includeContextPaths && sourcePath ? { sourcePath } : {}),
    ...(redaction.includeContextPaths && reportPath ? { reportPath } : {}),
    ...(tags ? { tags: [...tags] } : {}),
    ...(trace ? { trace: { ...trace } } : {}),
    ...(metadata ? { metadata: filterMetadata(metadata, redaction.metadataAllowlist) } : {}),
  };
  const redactionCopy = normalizeRedaction(redaction);
  if (contextRedaction && redactionCopy) exportContext.redaction = redactionCopy;
  return structuredClone(exportContext) as EvalReportExportContext;
}

/**
 * Create an eval report copy with external-export redaction applied.
 *
 * Previous export results and unknown report fields are never included in the
 * returned report.
 */
export function redactEvalReportForExport(
  report: EvalReport,
  redaction: EvalReportExportRedaction = {},
): EvalReport {
  try {
    const normalizedRedaction = normalizeRedaction(redaction) ?? {};
    const { dataset, metadata, records, summary } = report;
    const sanitized: EvalReport = {
      ...copyKnownFields(report, REPORT_PUBLIC_KEYS),
      summary: redactReportSummary(summary, normalizedRedaction),
      records: records.map((record) => redactRecord(record, normalizedRedaction)),
    };
    if (dataset) sanitized.dataset = redactDatasetMetadata(dataset, normalizedRedaction);
    const redactedMetadata = redactReportMetadata(metadata, normalizedRedaction);
    if (redactedMetadata) sanitized.metadata = redactedMetadata;
    return structuredClone(sanitized) as EvalReport;
  } catch (error) {
    if (isVeryfrontErrorWithSlug(error, "extension-validation")) throw error;
    throw EXTENSION_VALIDATION_ERROR.create({
      message: "Eval report could not be redacted safely",
    });
  }
}

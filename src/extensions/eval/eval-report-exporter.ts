/**
 * Eval report exporter extension contract.
 *
 * A single `EvalReportExporterRegistry` implementation lives in the contract
 * registry under {@link EvalReportExporterRegistryName}. Vendor extensions
 * resolve that registry during setup() and register one exporter each.
 *
 * @module extensions/eval/eval-report-exporter
 */

import type { EvalMetricResult, EvalRecord, EvalReport } from "#veryfront/eval";

type EvalReportExportMaybePromise<T> = T | Promise<T>;

/** Contract name used for `resolve()` / `provide()`. */
export const EvalReportExporterRegistryName = "EvalReportExporterRegistry" as const;

/** Sentinel used when record payload fields are removed for external export. */
export const EvalReportRedactedValue = "[redacted]" as const;

/** Redaction policy applied before reports leave the process. */
export interface EvalReportExportRedaction {
  /** Include dataset input payloads. Defaults to false. */
  includeInputs?: boolean;
  /** Include target output payloads. Defaults to false. */
  includeOutputs?: boolean;
  /** Include reference answer payloads. Defaults to false. */
  includeReferences?: boolean;
  /** Include trace events and tool-call metadata. Defaults to false. */
  includeTraces?: boolean;
  /** Include retrieved RAG context passages. Defaults to false. */
  includeRetrievedContext?: boolean;
  /** Include answer citation payloads. Defaults to false. */
  includeCitations?: boolean;
  /** Include metric/check explanations. Defaults to false. */
  includeMetricExplanations?: boolean;
  /** Include metric/check evidence payloads. Defaults to false. */
  includeMetricEvidence?: boolean;
  /** Record metadata keys that can be exported. Defaults to none. */
  metadataAllowlist?: string[];
}

/** Trace correlation fields that connect eval exports to runtime spans. */
export interface EvalReportExportTraceContext {
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
}

/** Context passed to eval report exporters. */
export interface EvalReportExportContext {
  projectId?: string;
  projectReference?: string;
  evalId?: string;
  sourcePath?: string;
  reportPath?: string;
  environment?: string;
  branch?: string;
  commitSha?: string;
  runUrl?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  trace?: EvalReportExportTraceContext;
  redaction?: EvalReportExportRedaction;
}

/** Optional receipt returned by a vendor exporter. */
export interface EvalReportExportReceipt {
  externalRunId?: string;
  url?: string;
  metadata?: Record<string, unknown>;
}

/** Vendor or backend implementation that receives sanitized eval reports. */
export interface EvalReportExporter {
  /** Stable exporter id, for example `braintrust`, `langfuse`, or `langsmith`. */
  readonly id: string;
  export(
    report: EvalReport,
    context: EvalReportExportContext,
  ): EvalReportExportMaybePromise<EvalReportExportReceipt | void>;
}

/** Successful exporter result. */
export interface EvalReportExportSuccess {
  exporterId: string;
  ok: true;
  receipt?: EvalReportExportReceipt;
}

/** Failed exporter result. Failures are captured so later exporters still run. */
export interface EvalReportExportFailure {
  exporterId: string;
  ok: false;
  error: string;
}

/** Result for one exporter invocation. */
export type EvalReportExportResult =
  | EvalReportExportSuccess
  | EvalReportExportFailure;

/** Registry contract. Single impl created at bootstrap. */
export interface EvalReportExporterRegistry {
  register(exporter: EvalReportExporter): void;
  unregister(id: string): void;
  get(id: string): EvalReportExporter | undefined;
  require(id: string): EvalReportExporter;
  list(): EvalReportExporter[];
  has(id: string): boolean;
  export(
    report: EvalReport,
    context?: EvalReportExportContext,
  ): Promise<EvalReportExportResult[]>;
}

function filterMetadata(
  metadata: Record<string, unknown>,
  allowlist: string[] | undefined,
): Record<string, unknown> {
  if (!allowlist || allowlist.length === 0) return {};
  const allowed = new Set(allowlist);
  return Object.fromEntries(
    Object.entries(metadata).filter(([key]) => allowed.has(key)),
  );
}

function redactRecord(
  record: EvalRecord,
  redaction: EvalReportExportRedaction,
): EvalRecord {
  const redacted: EvalRecord = {
    ...record,
    input: redaction.includeInputs ? record.input : EvalReportRedactedValue,
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

  return redacted;
}

function redactMetricResults(
  results: EvalMetricResult[],
  redaction: EvalReportExportRedaction,
): EvalMetricResult[] {
  return results.map((result) => {
    const redacted: EvalMetricResult = { ...result };
    if (!redaction.includeMetricExplanations) {
      delete redacted.explanation;
    }
    if (!redaction.includeMetricEvidence) {
      delete redacted.evidence;
    }
    return redacted;
  });
}

/** Create an eval report copy with external-export redaction applied. */
export function redactEvalReportForExport(
  report: EvalReport,
  redaction: EvalReportExportRedaction = {},
): EvalReport {
  const cloned = structuredClone(report) as EvalReport;
  return {
    ...cloned,
    records: cloned.records.map((record) => redactRecord(record, redaction)),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class EvalReportExporterRegistryImpl implements EvalReportExporterRegistry {
  private readonly exporters = new Map<string, EvalReportExporter>();

  register(exporter: EvalReportExporter): void {
    if (this.exporters.has(exporter.id)) {
      return;
    }
    this.exporters.set(exporter.id, exporter);
  }

  unregister(id: string): void {
    this.exporters.delete(id);
  }

  get(id: string): EvalReportExporter | undefined {
    return this.exporters.get(id);
  }

  require(id: string): EvalReportExporter {
    const exporter = this.exporters.get(id);
    if (exporter) return exporter;
    const known = [...this.exporters.keys()].join(", ") || "(none)";
    throw new Error(
      `No EvalReportExporter registered for "${id}". Known exporters: ${known}.`,
    );
  }

  has(id: string): boolean {
    return this.exporters.has(id);
  }

  list(): EvalReportExporter[] {
    return [...this.exporters.values()];
  }

  async export(
    report: EvalReport,
    context: EvalReportExportContext = {},
  ): Promise<EvalReportExportResult[]> {
    const results: EvalReportExportResult[] = [];

    for (const exporter of this.exporters.values()) {
      try {
        const sanitizedReport = redactEvalReportForExport(report, context.redaction);
        const receipt = await exporter.export(sanitizedReport, context);
        const result: EvalReportExportSuccess = { exporterId: exporter.id, ok: true };
        if (receipt !== undefined) result.receipt = receipt;
        results.push(result);
      } catch (error) {
        results.push({
          exporterId: exporter.id,
          ok: false,
          error: errorMessage(error),
        });
      }
    }

    return results;
  }
}

/** Create an eval report exporter registry. */
export function createEvalReportExporterRegistry(): EvalReportExporterRegistry {
  return new EvalReportExporterRegistryImpl();
}

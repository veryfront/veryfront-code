/**
 * Public contracts for eval report exporter extensions.
 *
 * @module extensions/eval/eval-report-exporter-contract
 */

import type { EvalReport } from "#veryfront/eval/types.ts";

export type { EvalReport } from "#veryfront/eval/types.ts";

/** Contract name used for `resolve()` and `provide()`. */
export const EvalReportExporterRegistryName = "EvalReportExporterRegistry" as const;

/** Sentinel used when record payload fields are removed for external export. */
export const EvalReportRedactedValue = "[redacted]" as const;

/** Value that can be returned synchronously or as a promise. */
export type EvalReportExportMaybePromise<T> = T | Promise<T>;

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
  /** Include dataset source paths. Defaults to false. */
  includeDatasetPath?: boolean;
  /** Include local source and report paths from export context. Defaults to false. */
  includeContextPaths?: boolean;
  /** Include record execution errors. Defaults to false. */
  includeErrors?: boolean;
  /** Up to 128 report, record, and context metadata keys to export. Defaults to none. */
  metadataAllowlist?: string[];
}

/** Trace correlation fields that connect eval exports to runtime spans. */
export interface EvalReportExportTraceContext {
  /** Trace identifier shared by related spans. */
  traceId?: string;
  /** Span identifier for the eval export operation. */
  spanId?: string;
  /** Parent span identifier, when the export belongs to another operation. */
  parentSpanId?: string;
}

/** Context passed to eval report exporters. */
export interface EvalReportExportContext {
  /** Project identifier associated with the report. */
  projectId?: string;
  /** User-facing project reference associated with the report. */
  projectReference?: string;
  /** Eval definition identifier. */
  evalId?: string;
  /** Local source path, included only when the redaction policy allows it. */
  sourcePath?: string;
  /** Local report path, included only when the redaction policy allows it. */
  reportPath?: string;
  /** Runtime environment name. */
  environment?: string;
  /** Source-control branch name. */
  branch?: string;
  /** Source-control commit identifier. */
  commitSha?: string;
  /** External run URL associated with the report. */
  runUrl?: string;
  /** Up to 128 export tags. */
  tags?: string[];
  /** Allowlisted metadata included with the export. */
  metadata?: Record<string, unknown>;
  /** Trace fields used to correlate the export. */
  trace?: EvalReportExportTraceContext;
  /** Redaction policy applied before the exporter is called. */
  redaction?: EvalReportExportRedaction;
}

/** Optional receipt returned by a vendor exporter. */
export interface EvalReportExportReceipt {
  /** External run id with at most 1024 characters. */
  externalRunId?: string;
  /** Absolute HTTP(S) external run URL with at most 4096 characters. */
  url?: string;
  /** Bounded, acyclic JSON metadata. */
  metadata?: Record<string, unknown>;
}

/** Vendor or backend implementation that receives sanitized eval reports. */
export interface EvalReportExporter {
  /** Stable exporter id using 1 to 128 alphanumeric, `.`, `_`, `:`, or `-` characters. */
  readonly id: string;
  /** Export one sanitized report and optionally return a bounded receipt. */
  export(
    report: EvalReport,
    context: EvalReportExportContext,
  ): EvalReportExportMaybePromise<EvalReportExportReceipt | void>;
}

/** Successful exporter result. */
export interface EvalReportExportSuccess {
  /** Identifier of the exporter that completed. */
  exporterId: string;
  /** Success discriminator. */
  ok: true;
  /** Optional bounded vendor receipt. */
  receipt?: EvalReportExportReceipt;
}

/** Failed exporter result. Failures are captured so later exporters still run. */
export interface EvalReportExportFailure {
  /** Identifier of the exporter that failed. */
  exporterId: string;
  /** Failure discriminator. */
  ok: false;
  /** Safe public failure message. Raw exporter errors are never returned. */
  error: string;
}

/** Result for one exporter invocation. */
export type EvalReportExportResult =
  | EvalReportExportSuccess
  | EvalReportExportFailure;

/** Registry contract. A single implementation is created at bootstrap. */
export interface EvalReportExporterRegistry {
  /** Register up to 256 exporters. Conflicting duplicate ids throw. */
  register(exporter: EvalReportExporter): void;
  /** Remove the exporter registered for `id`. */
  unregister(id: string): void;
  /** Return the exporter registered for `id`, if one exists. */
  get(id: string): EvalReportExporter | undefined;
  /** Return the exporter registered for `id` or throw. */
  require(id: string): EvalReportExporter;
  /** Return registered exporters in insertion order. */
  list(): EvalReportExporter[];
  /** Return whether an exporter is registered for `id`. */
  has(id: string): boolean;
  /** Export a sanitized snapshot sequentially in registry insertion order. */
  export(
    report: EvalReport,
    context?: EvalReportExportContext,
  ): Promise<EvalReportExportResult[]>;
}

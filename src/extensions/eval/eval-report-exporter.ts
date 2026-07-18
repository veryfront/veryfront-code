/**
 * Eval report exporter extension contract.
 *
 * A single `EvalReportExporterRegistry` implementation lives in the contract
 * registry under {@link EvalReportExporterRegistryName}. Vendor extensions
 * resolve that registry during setup() and register one exporter each.
 *
 * @module extensions/eval/eval-report-exporter
 */

import type {
  EvalMetricResult,
  EvalRecord,
  EvalReport,
  EvalReportExportContext,
  EvalReportExporter,
  EvalReportExporterRegistry,
  EvalReportExportRedaction,
  EvalReportExportResult,
  EvalReportExportSuccess,
} from "#veryfront/eval/types.ts";

export type {
  EvalReportExportContext,
  EvalReportExporter,
  EvalReportExporterRegistry,
  EvalReportExportFailure,
  EvalReportExportReceipt,
  EvalReportExportRedaction,
  EvalReportExportResult,
  EvalReportExportSuccess,
  EvalReportExportTraceContext,
} from "#veryfront/eval/types.ts";

/** Contract name used for `resolve()` / `provide()`. */
export const EvalReportExporterRegistryName = "EvalReportExporterRegistry" as const;

/** Sentinel used when record payload fields are removed for external export. */
export const EvalReportRedactedValue = "[redacted]" as const;

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

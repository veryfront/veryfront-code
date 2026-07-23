/**
 * Default Map-backed eval report exporter registry.
 *
 * @module extensions/eval/eval-report-exporter-registry
 */

import type { EvalReport } from "#veryfront/eval/types.ts";
import { RESOURCE_NOT_FOUND } from "#veryfront/errors";
import {
  EXTENSION_CONFLICT_ERROR,
  EXTENSION_VALIDATION_ERROR,
} from "#veryfront/extensions/errors.ts";
import { identifierIssue } from "#veryfront/extensions/identifiers.ts";
import { cloneEvalReportExportReceipt } from "./eval-report-export-receipt.ts";
import type {
  EvalReportExportContext,
  EvalReportExporter,
  EvalReportExporterRegistry,
  EvalReportExportFailure,
  EvalReportExportResult,
  EvalReportExportSuccess,
} from "./eval-report-exporter-contract.ts";
import {
  normalizeRedaction,
  redactEvalReportExportContext,
  redactEvalReportForExport,
  snapshotEvalReportExportContext,
} from "./eval-report-redaction.ts";

const MAX_EXPORTERS = 256;
const MAX_EXPORTER_ID_LENGTH = 128;
const MAX_KNOWN_EXPORTERS_IN_ERROR = 20;
const EXPORT_FAILURE_MESSAGE = "Eval report export failed.";
const EXPORTER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

function isExporterObject(value: unknown): value is Record<string, unknown> {
  try {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  } catch {
    return false;
  }
}

function assertExporterId(id: unknown): asserts id is string {
  const issue = identifierIssue(id, MAX_EXPORTER_ID_LENGTH);
  if (issue || typeof id !== "string") {
    throw EXTENSION_VALIDATION_ERROR.create({
      message: `Eval report exporter id ${issue ?? "must be a non-empty string"}`,
    });
  }
  if (!EXPORTER_ID_PATTERN.test(id)) {
    throw EXTENSION_VALIDATION_ERROR.create({
      message:
        "Eval report exporter id must start with an alphanumeric character and contain only alphanumeric, dot, underscore, colon, or hyphen characters",
    });
  }
}

function readExporterId(exporter: { readonly id?: unknown }): unknown {
  try {
    return exporter.id;
  } catch {
    throw EXTENSION_VALIDATION_ERROR.create({
      message: "Eval report exporter properties must be readable",
    });
  }
}

function validateExporter(exporter: unknown): string {
  if (!isExporterObject(exporter)) {
    throw EXTENSION_VALIDATION_ERROR.create({
      message: "Eval report exporter must be an object",
    });
  }
  let id: unknown;
  let exportMethod: unknown;
  try {
    id = readExporterId(exporter);
    exportMethod = (exporter as { export?: unknown }).export;
  } catch {
    throw EXTENSION_VALIDATION_ERROR.create({
      message: "Eval report exporter properties must be readable",
    });
  }
  assertExporterId(id);
  if (typeof exportMethod !== "function") {
    throw EXTENSION_VALIDATION_ERROR.create({
      message: "Eval report exporter export must be a function",
    });
  }
  return id;
}

function assertStableExporterId(id: string, exporter: EvalReportExporter): void {
  if (readExporterId(exporter) !== id) {
    throw EXTENSION_VALIDATION_ERROR.create({
      message: "Eval report exporter id cannot change after registration",
    });
  }
}

function exportFailure(exporterId: string): EvalReportExportFailure {
  return {
    exporterId,
    ok: false,
    error: EXPORT_FAILURE_MESSAGE,
  };
}

class EvalReportExporterRegistryImpl implements EvalReportExporterRegistry {
  private readonly exporters = new Map<string, EvalReportExporter>();
  private readonly registeredIds = new WeakMap<EvalReportExporter, string>();

  register(exporter: EvalReportExporter): void {
    const id = validateExporter(exporter);
    if (readExporterId(exporter) !== id) {
      throw EXTENSION_VALIDATION_ERROR.create({
        message: "Eval report exporter id must remain stable during registration",
      });
    }
    const registeredId = this.registeredIds.get(exporter);
    if (registeredId !== undefined && registeredId !== id) {
      throw EXTENSION_VALIDATION_ERROR.create({
        message: "Eval report exporter id cannot change after registration",
      });
    }
    const existing = this.exporters.get(id);
    if (existing === exporter) return;
    if (existing) {
      throw EXTENSION_CONFLICT_ERROR.create({
        message: `Eval report exporter "${id}" is already registered`,
      });
    }
    if (this.exporters.size >= MAX_EXPORTERS) {
      throw EXTENSION_VALIDATION_ERROR.create({
        message: `You can register at most ${MAX_EXPORTERS} eval report exporters`,
      });
    }
    this.exporters.set(id, exporter);
    this.registeredIds.set(exporter, id);
  }

  unregister(id: string): void {
    assertExporterId(id);
    const exporter = this.exporters.get(id);
    this.exporters.delete(id);
    if (exporter) this.registeredIds.delete(exporter);
  }

  get(id: string): EvalReportExporter | undefined {
    assertExporterId(id);
    const exporter = this.exporters.get(id);
    if (exporter) assertStableExporterId(id, exporter);
    return exporter;
  }

  require(id: string): EvalReportExporter {
    const exporter = this.get(id);
    if (exporter) return exporter;
    const knownIds = [...this.exporters.keys()];
    const known = knownIds.slice(0, MAX_KNOWN_EXPORTERS_IN_ERROR).join(", ") || "(none)";
    const suffix = knownIds.length > MAX_KNOWN_EXPORTERS_IN_ERROR ? ", ..." : "";
    throw RESOURCE_NOT_FOUND.create({
      message:
        `No eval report exporter is registered for "${id}". Known exporters: ${known}${suffix}.`,
    });
  }

  has(id: string): boolean {
    assertExporterId(id);
    const exporter = this.exporters.get(id);
    if (exporter) assertStableExporterId(id, exporter);
    return exporter !== undefined;
  }

  list(): EvalReportExporter[] {
    return [...this.exporters.entries()].map(([id, exporter]) => {
      assertStableExporterId(id, exporter);
      return exporter;
    });
  }

  async export(
    report: EvalReport,
    context: EvalReportExportContext = {},
  ): Promise<EvalReportExportResult[]> {
    const results: EvalReportExportResult[] = [];
    const exporters = [...this.exporters.entries()];
    if (exporters.length === 0) return results;
    let sanitizedReport: EvalReport;
    let sanitizedContext: EvalReportExportContext;

    try {
      const contextSnapshot = snapshotEvalReportExportContext(context);
      const redaction = normalizeRedaction(contextSnapshot.redaction) ?? {};
      sanitizedReport = redactEvalReportForExport(report, redaction);
      sanitizedContext = redactEvalReportExportContext(contextSnapshot, redaction);
    } catch {
      return exporters.map(([exporterId]) => exportFailure(exporterId));
    }

    for (const [exporterId, exporter] of exporters) {
      try {
        assertStableExporterId(exporterId, exporter);
        const receipt = await exporter.export(
          structuredClone(sanitizedReport) as EvalReport,
          structuredClone(sanitizedContext) as EvalReportExportContext,
        );
        const result: EvalReportExportSuccess = { exporterId, ok: true };
        if (receipt !== undefined) {
          result.receipt = cloneEvalReportExportReceipt(receipt);
        }
        results.push(result);
      } catch {
        results.push(exportFailure(exporterId));
      }
    }

    return results;
  }
}

/** Create an eval report exporter registry. */
export function createEvalReportExporterRegistry(): EvalReportExporterRegistry {
  return new EvalReportExporterRegistryImpl();
}

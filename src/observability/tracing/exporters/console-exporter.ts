/**
 * Console Span Exporter
 *
 * Implements the OTel SpanExporter interface for dev mode.
 * Formats spans as colored terminal output and appends to SpanBuffer.
 */

import { serverLogger } from "#veryfront/utils";
import { getSpanBuffer, type SpanEntry, type SpanKind, type SpanStatus } from "../span-buffer.ts";

const logger = serverLogger.component("tracing");

interface ReadableSpan {
  name: string;
  kind: number;
  spanContext(): { traceId: string; spanId: string };
  parentSpanId?: string;
  startTime: [number, number]; // [seconds, nanoseconds]
  endTime: [number, number];
  status: { code: number; message?: string };
  attributes: Record<string, unknown>;
  duration: [number, number];
}

interface ExportResult {
  code: number;
}

const SPAN_KIND_MAP: Record<number, SpanKind> = {
  0: "internal",
  1: "server",
  2: "client",
  3: "producer",
  4: "consumer",
};

const STATUS_CODE_MAP: Record<number, SpanStatus> = {
  0: "unset",
  1: "ok",
  2: "error",
};

// ANSI color codes
const COLORS = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  gray: "\x1b[90m",
  white: "\x1b[37m",
  magenta: "\x1b[35m",
};

function hrtimeToMs(hrtime: [number, number]): number {
  return hrtime[0] * 1000 + hrtime[1] / 1_000_000;
}

function hrtimeToEpochMs(hrtime: [number, number]): number {
  return hrtime[0] * 1000 + hrtime[1] / 1_000_000;
}

function formatDuration(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}us`;
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function statusColor(status: SpanStatus): string {
  if (status === "error") return COLORS.red;
  if (status === "ok") return COLORS.green;
  return COLORS.yellow;
}

function kindLabel(kind: SpanKind): string {
  if (kind === "server") return `${COLORS.cyan}[srv]${COLORS.reset}`;
  if (kind === "client") return `${COLORS.magenta}[cli]${COLORS.reset}`;
  return `${COLORS.gray}[int]${COLORS.reset}`;
}

function flattenAttributes(
  attrs: Record<string, unknown>,
): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      result[key] = value;
    } else if (value != null) {
      result[key] = String(value);
    }
  }
  return result;
}

function formatAttributes(attrs: Record<string, string | number | boolean>): string {
  const entries = Object.entries(attrs);
  if (entries.length === 0) return "";

  const parts = entries
    .filter(([key]) => !key.startsWith("_"))
    .slice(0, 5)
    .map(([key, value]) => `${COLORS.gray}${key}=${COLORS.reset}${value}`);

  if (entries.length > 5) {
    parts.push(`${COLORS.gray}+${entries.length - 5} more${COLORS.reset}`);
  }

  return parts.length > 0 ? ` ${parts.join(" ")}` : "";
}

export function convertReadableSpan(span: ReadableSpan): Omit<SpanEntry, "id"> {
  const durationMs = hrtimeToMs(span.duration);
  const startTimeMs = hrtimeToEpochMs(span.startTime);
  const endTimeMs = hrtimeToEpochMs(span.endTime);
  const kind = SPAN_KIND_MAP[span.kind] ?? "internal";
  const status = STATUS_CODE_MAP[span.status.code] ?? "unset";
  const attributes = flattenAttributes(span.attributes);

  return {
    traceId: span.spanContext().traceId,
    spanId: span.spanContext().spanId,
    parentSpanId: span.parentSpanId,
    name: span.name,
    kind,
    status,
    statusMessage: span.status.message,
    startTime: startTimeMs,
    endTime: endTimeMs,
    duration: durationMs,
    attributes,
  };
}

function formatSpanLine(entry: Omit<SpanEntry, "id">): string {
  const time = new Date(entry.startTime).toISOString().slice(11, 23);
  const dur = formatDuration(entry.duration);
  const statusStr = statusColor(entry.status);
  const kindStr = kindLabel(entry.kind);
  const attrs = formatAttributes(entry.attributes);

  return (
    `${COLORS.dim}${time}${COLORS.reset} ` +
    `${kindStr} ` +
    `${statusStr}${COLORS.bold}${entry.name}${COLORS.reset} ` +
    `${COLORS.white}${dur}${COLORS.reset}` +
    `${attrs}`
  );
}

export class ConsoleSpanExporter {
  private _shutdown = false;

  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    if (this._shutdown) {
      resultCallback({ code: 1 });
      return;
    }

    const buffer = getSpanBuffer();

    for (const span of spans) {
      try {
        const entry = convertReadableSpan(span);

        // Append to SpanBuffer for dashboard
        buffer.append(entry);

        // Log to console
        logger.info(formatSpanLine(entry));
      } catch {
        // Skip malformed spans
      }
    }

    resultCallback({ code: 0 });
  }

  shutdown(): Promise<void> {
    this._shutdown = true;
    return Promise.resolve();
  }

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }
}

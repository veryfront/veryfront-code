import { AsyncLocalStorage } from "node:async_hooks";
import { getEnv } from "#veryfront/platform/compat/process.ts";
import { normalizeHttpMethod, stripTelemetryControlCharacters } from "./telemetry-safety.ts";

/** Bounded timing record for one completed request. */
export interface RequestProfileRecord {
  /** Monotonic sequence number within the current process. */
  sequence: number;
  /** Code-owned request category. */
  category: string;
  /** Normalized HTTP method. */
  method: string;
  /** Request pathname without query or fragment data. */
  pathname: string;
  /** Optional bounded project slug for local diagnostics. */
  projectSlug?: string;
  /** Optional bounded request mode. */
  requestMode?: string;
  /** Final HTTP status when one was recorded. */
  status?: number;
  /** ISO timestamp captured when profiling started. */
  startedAt: string;
  /** ISO timestamp captured when profiling completed. */
  completedAt: string;
  /** Total elapsed duration in milliseconds. */
  totalMs: number;
  /** Elapsed duration by bounded phase name. */
  phases: Record<string, number>;
}

export interface RequestProfileContextUpdate {
  projectSlug?: string;
  requestMode?: string;
}

interface RequestProfileSession {
  category: string;
  method: string;
  pathname: string;
  projectSlug?: string;
  requestMode?: string;
  startedAt: number;
  phases: Map<string, number>;
  finalized: boolean;
}

const storage = new AsyncLocalStorage<RequestProfileSession>();
const records: RequestProfileRecord[] = [];
const MAX_RECORDS = 200;
const MAX_PHASES = 50;
const MAX_PHASE_NAME_LENGTH = 64;
let sequence = 0;

function roundMs(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value * 100) / 100;
}

function normalizeText(value: unknown, maxLength: number, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const normalized = stripTelemetryControlCharacters(value).slice(0, maxLength);
  return normalized || fallback;
}

function normalizePathname(value: unknown): string {
  if (typeof value !== "string") return "/";
  try {
    return new URL(value, "http://local.invalid").pathname.slice(0, 2_048) || "/";
  } catch {
    const delimiter = value.search(/[?#]/);
    const pathname = delimiter === -1 ? value : value.slice(0, delimiter);
    return normalizeText(pathname, 2_048, "/");
  }
}

function normalizePhaseName(name: unknown): string {
  return normalizeText(name, MAX_PHASE_NAME_LENGTH, "phase")
    .replace(/[^A-Za-z0-9!#$%&'*+\-.^_`|~]/g, "_");
}

function recordPhase(session: RequestProfileSession, name: unknown, durationMs: number): void {
  const normalizedName = normalizePhaseName(name);
  if (!session.phases.has(normalizedName) && session.phases.size >= MAX_PHASES) return;
  session.phases.set(
    normalizedName,
    roundMs((session.phases.get(normalizedName) ?? 0) + roundMs(durationMs)),
  );
}

function cloneRecord(record: RequestProfileRecord): RequestProfileRecord {
  return { ...record, phases: { ...record.phases } };
}

function shouldEnableProfiling(): boolean {
  return readProfilingEnv("VERYFRONT_ENABLE_PERF_PROFILING") === "1";
}

function shouldEnableServerTiming(): boolean {
  return readProfilingEnv("VERYFRONT_ENABLE_SERVER_TIMING") === "1";
}

function shouldEnableSlowRequestProfiling(): boolean {
  return readProfilingEnv("VERYFRONT_DISABLE_SLOW_REQUEST_PROFILING") !== "1";
}

function readProfilingEnv(key: string): string | undefined {
  try {
    return getEnv(key);
  } catch {
    return undefined;
  }
}

function readMonotonicTime(): number {
  try {
    const value = performance.now();
    return Number.isFinite(value) && value >= 0 ? value : 0;
  } catch {
    return 0;
  }
}

function isHtmlPath(pathname: string): boolean {
  return !pathname.startsWith("/_") && !pathname.startsWith("/api/") &&
    !/\.[a-zA-Z0-9]+$/.test(pathname);
}

function shouldProfilePath(pathname: string): boolean {
  return pathname.startsWith("/bench/") ||
    pathname.startsWith("/api/bench/") ||
    pathname.startsWith("/_vf_styles/") ||
    pathname.startsWith("/_vf_modules/") ||
    (shouldEnableServerTiming() && pathname.startsWith("/_veryfront/page-data/")) ||
    (shouldEnableServerTiming() && isHtmlPath(pathname));
}

/** Check whether request profiling is enabled for an optional pathname. */
export function isRequestProfilingEnabled(pathname?: string): boolean {
  const explicitProfiling = shouldEnableProfiling() || shouldEnableServerTiming();
  const slowRequestProfiling = shouldEnableSlowRequestProfiling();

  if (!explicitProfiling && !slowRequestProfiling) return false;
  if (!pathname) return true;
  if (slowRequestProfiling && isHtmlPath(pathname)) return true;
  return shouldProfilePath(pathname);
}

/** Run an internal request callback with phase profiling enabled when configured. */
export async function runWithRequestProfiling<T>(
  options: {
    category: string;
    method: string;
    pathname: string;
    projectSlug?: string;
    requestMode?: string;
  },
  fn: () => Promise<T>,
): Promise<T> {
  if (!isRequestProfilingEnabled(options.pathname)) {
    return await fn();
  }

  const session: RequestProfileSession = {
    category: normalizeText(options.category, 64, "unknown"),
    method: normalizeHttpMethod(options.method),
    pathname: normalizePathname(options.pathname),
    projectSlug: options.projectSlug === undefined
      ? undefined
      : normalizeText(options.projectSlug, 128, "unknown"),
    requestMode: options.requestMode === undefined
      ? undefined
      : normalizeText(options.requestMode, 64, "unknown"),
    startedAt: readMonotonicTime(),
    phases: new Map(),
    finalized: false,
  };

  return await storage.run(session, fn);
}

/** Measure an asynchronous phase on the active request profile. */
export async function profilePhase<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const session = storage.getStore();
  if (!session) return await fn();

  const startedAt = readMonotonicTime();
  try {
    return await fn();
  } finally {
    const duration = readMonotonicTime() - startedAt;
    recordPhase(session, name, duration);
  }
}

/** Add or accumulate a bounded phase duration on the active request profile. */
export function markRequestProfilePhase(name: string, durationMs = 0): void {
  const session = storage.getStore();
  if (!session) return;

  recordPhase(session, name, durationMs);
}

/** Measure a synchronous phase on the active request profile. */
export function profileSyncPhase<T>(name: string, fn: () => T): T {
  const session = storage.getStore();
  if (!session) return fn();

  const startedAt = readMonotonicTime();
  try {
    return fn();
  } finally {
    const duration = readMonotonicTime() - startedAt;
    recordPhase(session, name, duration);
  }
}

/** Update bounded metadata on the active request profile. */
export function updateRequestProfileContext(update: RequestProfileContextUpdate): void {
  const session = storage.getStore();
  if (!session) return;

  if (update.projectSlug !== undefined) {
    session.projectSlug = normalizeText(update.projectSlug, 128, "unknown");
  }
  if (update.requestMode !== undefined) {
    session.requestMode = normalizeText(update.requestMode, 64, "unknown");
  }
}

/** Finalize the active request profile once. */
export function finalizeRequestProfiling(status?: number): RequestProfileRecord | null {
  const session = storage.getStore();
  if (!session || session.finalized) return null;
  session.finalized = true;
  const completedAt = readMonotonicTime();
  const wallClock = Date.now();
  const totalMs = roundMs(completedAt - session.startedAt);

  const record: RequestProfileRecord = {
    sequence: ++sequence,
    category: session.category,
    method: session.method,
    pathname: session.pathname,
    projectSlug: session.projectSlug,
    requestMode: session.requestMode,
    status: Number.isSafeInteger(status) && (status as number) >= 100 && (status as number) <= 599
      ? status
      : undefined,
    startedAt: new Date(wallClock - totalMs).toISOString(),
    completedAt: new Date(wallClock).toISOString(),
    totalMs,
    phases: Object.fromEntries(session.phases.entries()),
  };

  records.push(cloneRecord(record));
  while (records.length > MAX_RECORDS) records.shift();

  return cloneRecord(record);
}

function sanitizeMetricName(name: string): string {
  return normalizePhaseName(name);
}

function formatDuration(value: number): string {
  return roundMs(value).toFixed(2);
}

/** Build a bounded Server-Timing header value. */
export function buildServerTimingHeader(record: RequestProfileRecord): string {
  const metrics = [`total;dur=${formatDuration(record.totalMs)}`];

  for (const [name, duration] of Object.entries(record.phases).slice(0, 20)) {
    metrics.push(`${sanitizeMetricName(name)};dur=${formatDuration(duration)}`);
  }

  return metrics.join(", ");
}

/** Add Server-Timing to a response when configured. */
export function withServerTimingHeader(
  response: Response,
  record: RequestProfileRecord | null,
): Response {
  if (!record || !shouldEnableServerTiming()) return response;

  const value = buildServerTimingHeader(record);

  try {
    response.headers.set("Server-Timing", value);
    return response;
  } catch {
    const headers = new Headers(response.headers);
    headers.set("Server-Timing", value);
    try {
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch {
      return response;
    }
  }
}

/** Return a deep snapshot of recent request profiles. */
export function snapshotRequestProfiles(): {
  enabled: boolean;
  last_sequence: number;
  records: RequestProfileRecord[];
} {
  return {
    enabled: shouldEnableProfiling() || shouldEnableServerTiming() ||
      shouldEnableSlowRequestProfiling(),
    last_sequence: sequence,
    records: records.map(cloneRecord),
  };
}

/** Clear request profiling history. */
export function resetRequestProfiles(): void {
  records.length = 0;
  sequence = 0;
}

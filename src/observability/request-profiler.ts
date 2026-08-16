import { AsyncLocalStorage } from "node:async_hooks";
import { getEnv } from "#veryfront/platform/compat/process/env.ts";
import {
  nonNegativeFiniteMeasure,
  saturatingAdd,
  saturatingAddMeasure,
} from "./metrics/numeric.ts";
import {
  MAX_OBSERVABILITY_CONFIG_TEXT_LENGTH,
  MAX_OBSERVABILITY_NAME_LENGTH,
  MAX_REQUEST_PROFILE_PHASES,
} from "./limits.ts";
import { sanitizeTelemetryText } from "./telemetry-error.ts";

export interface RequestProfileRecord {
  sequence: number;
  category: string;
  method: string;
  pathname: string;
  projectSlug?: string;
  requestMode?: string;
  status?: number;
  startedAt: string;
  completedAt: string;
  totalMs: number;
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
let sequence = 0;

/** Round to 2 decimal places (Server-Timing millisecond precision). */
export function roundMs(value: number): number {
  if (value >= Number.MAX_SAFE_INTEGER) return Number.MAX_SAFE_INTEGER;
  return Math.round(value * 100) / 100;
}

function normalizeDuration(value: number): number {
  return roundMs(nonNegativeFiniteMeasure(value));
}

function addPhaseDuration(session: RequestProfileSession, name: string, durationMs: number): void {
  if (session.finalized || typeof name !== "string") return;
  const normalizedName = sanitizeTelemetryText(name, MAX_OBSERVABILITY_NAME_LENGTH);
  if (
    !session.phases.has(normalizedName) &&
    session.phases.size >= MAX_REQUEST_PROFILE_PHASES
  ) {
    return;
  }
  session.phases.set(
    normalizedName,
    normalizeDuration(
      saturatingAddMeasure(
        session.phases.get(normalizedName) ?? 0,
        normalizeDuration(durationMs),
      ),
    ),
  );
}

function snapshotRecord(record: RequestProfileRecord): RequestProfileRecord {
  return {
    ...record,
    phases: { ...record.phases },
  };
}

function normalizeProfileText(
  value: unknown,
  maxLength: number,
): string | null {
  return typeof value === "string" ? sanitizeTelemetryText(value, maxLength) : null;
}

function shouldEnableProfiling(): boolean {
  return getEnv("VERYFRONT_ENABLE_PERF_PROFILING") === "1";
}

function shouldEnableServerTiming(): boolean {
  return getEnv("VERYFRONT_ENABLE_SERVER_TIMING") === "1";
}

function shouldEnableSlowRequestProfiling(): boolean {
  return getEnv("VERYFRONT_DISABLE_SLOW_REQUEST_PROFILING") !== "1";
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

export function isRequestProfilingEnabled(pathname?: string): boolean {
  const explicitProfiling = shouldEnableProfiling() || shouldEnableServerTiming();
  const slowRequestProfiling = shouldEnableSlowRequestProfiling();

  if (!explicitProfiling && !slowRequestProfiling) return false;
  if (!pathname) return true;
  if (slowRequestProfiling && isHtmlPath(pathname)) return true;
  return shouldProfilePath(pathname);
}

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
  let category: string | null;
  let method: string | null;
  let pathname: string | null;
  let projectSlug: string | undefined;
  let requestMode: string | undefined;
  try {
    category = normalizeProfileText(
      options.category,
      MAX_OBSERVABILITY_NAME_LENGTH,
    );
    method = normalizeProfileText(
      options.method,
      MAX_OBSERVABILITY_NAME_LENGTH,
    );
    pathname = normalizeProfileText(
      options.pathname,
      MAX_OBSERVABILITY_CONFIG_TEXT_LENGTH,
    );
    projectSlug = options.projectSlug === undefined ? undefined : normalizeProfileText(
      options.projectSlug,
      MAX_OBSERVABILITY_NAME_LENGTH,
    ) ?? undefined;
    requestMode = options.requestMode === undefined ? undefined : normalizeProfileText(
      options.requestMode,
      MAX_OBSERVABILITY_NAME_LENGTH,
    ) ?? undefined;
  } catch {
    return await fn();
  }

  if (
    category === null || method === null || pathname === null ||
    !isRequestProfilingEnabled(pathname)
  ) {
    return await fn();
  }

  const session: RequestProfileSession = {
    category,
    method,
    pathname,
    projectSlug,
    requestMode,
    startedAt: performance.now(),
    phases: new Map(),
    finalized: false,
  };

  return await storage.run(session, fn);
}

export async function profilePhase<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const session = storage.getStore();
  if (!session) return await fn();

  const startedAt = performance.now();
  try {
    return await fn();
  } finally {
    const duration = performance.now() - startedAt;
    addPhaseDuration(session, name, duration);
  }
}

export function markRequestProfilePhase(name: string, durationMs = 0): void {
  const session = storage.getStore();
  if (!session) return;

  addPhaseDuration(session, name, durationMs);
}

export function profileSyncPhase<T>(name: string, fn: () => T): T {
  const session = storage.getStore();
  if (!session) return fn();

  const startedAt = performance.now();
  try {
    return fn();
  } finally {
    const duration = performance.now() - startedAt;
    addPhaseDuration(session, name, duration);
  }
}

export function updateRequestProfileContext(update: RequestProfileContextUpdate): void {
  const session = storage.getStore();
  if (!session || session.finalized) return;

  if (typeof update.projectSlug === "string") {
    session.projectSlug = sanitizeTelemetryText(
      update.projectSlug,
      MAX_OBSERVABILITY_NAME_LENGTH,
    );
  }
  if (typeof update.requestMode === "string") {
    session.requestMode = sanitizeTelemetryText(
      update.requestMode,
      MAX_OBSERVABILITY_NAME_LENGTH,
    );
  }
}

export function finalizeRequestProfiling(status?: number): RequestProfileRecord | null {
  const session = storage.getStore();
  if (!session || session.finalized) return null;
  session.finalized = true;
  sequence = saturatingAdd(sequence);

  const record: RequestProfileRecord = {
    sequence,
    category: session.category,
    method: session.method,
    pathname: session.pathname,
    projectSlug: session.projectSlug,
    requestMode: session.requestMode,
    status,
    startedAt: new Date(Date.now() - (performance.now() - session.startedAt)).toISOString(),
    completedAt: new Date().toISOString(),
    totalMs: normalizeDuration(performance.now() - session.startedAt),
    phases: Object.fromEntries(session.phases.entries()),
  };

  records.push(record);
  while (records.length > MAX_RECORDS) records.shift();

  return snapshotRecord(record);
}

function sanitizeMetricName(name: string): string {
  return name.replace(/[^A-Za-z0-9!#$%&'*+\-.^_`|~]/g, "_");
}

function formatDuration(value: number): string {
  return normalizeDuration(value).toFixed(2);
}

/** Build a Server-Timing header value from a total plus named phase durations. */
export function buildServerTimingValue(
  totalLabel: string,
  totalMs: number,
  phases: Iterable<[string, number]>,
): string {
  const metrics = [`${sanitizeMetricName(totalLabel)};dur=${formatDuration(totalMs)}`];
  for (const [name, duration] of phases) {
    metrics.push(`${sanitizeMetricName(name)};dur=${formatDuration(duration)}`);
  }
  return metrics.join(", ");
}

export function buildServerTimingHeader(record: RequestProfileRecord): string {
  return buildServerTimingValue(
    "total",
    record.totalMs,
    Object.entries(record.phases).slice(0, 20),
  );
}

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
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
}

export function snapshotRequestProfiles(): {
  enabled: boolean;
  last_sequence: number;
  records: RequestProfileRecord[];
} {
  return {
    enabled: shouldEnableProfiling() || shouldEnableServerTiming() ||
      shouldEnableSlowRequestProfiling(),
    last_sequence: sequence,
    records: records.map(snapshotRecord),
  };
}

export function resetRequestProfiles(): void {
  records.length = 0;
  sequence = 0;
}

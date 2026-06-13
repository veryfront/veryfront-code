import { AsyncLocalStorage } from "node:async_hooks";
import { getEnv } from "#veryfront/platform/compat/process.ts";

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
}

const storage = new AsyncLocalStorage<RequestProfileSession>();
const records: RequestProfileRecord[] = [];
const MAX_RECORDS = 200;
let sequence = 0;

function roundMs(value: number): number {
  return Math.round(value * 100) / 100;
}

function shouldEnableProfiling(): boolean {
  return getEnv("VERYFRONT_ENABLE_PERF_PROFILING") === "1";
}

function shouldEnableServerTiming(): boolean {
  return getEnv("VERYFRONT_ENABLE_SERVER_TIMING") === "1";
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
    (shouldEnableServerTiming() && isHtmlPath(pathname));
}

export function isRequestProfilingEnabled(pathname?: string): boolean {
  if (!shouldEnableProfiling() && !shouldEnableServerTiming()) return false;
  if (!pathname) return true;
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
  if (!isRequestProfilingEnabled(options.pathname)) {
    return await fn();
  }

  const session: RequestProfileSession = {
    ...options,
    startedAt: performance.now(),
    phases: new Map(),
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
    session.phases.set(name, roundMs((session.phases.get(name) ?? 0) + duration));
  }
}

export function profileSyncPhase<T>(name: string, fn: () => T): T {
  const session = storage.getStore();
  if (!session) return fn();

  const startedAt = performance.now();
  try {
    return fn();
  } finally {
    const duration = performance.now() - startedAt;
    session.phases.set(name, roundMs((session.phases.get(name) ?? 0) + duration));
  }
}

export function updateRequestProfileContext(update: RequestProfileContextUpdate): void {
  const session = storage.getStore();
  if (!session) return;

  if (update.projectSlug !== undefined) session.projectSlug = update.projectSlug;
  if (update.requestMode !== undefined) session.requestMode = update.requestMode;
}

export function finalizeRequestProfiling(status?: number): RequestProfileRecord | null {
  const session = storage.getStore();
  if (!session) return null;

  const record: RequestProfileRecord = {
    sequence: ++sequence,
    category: session.category,
    method: session.method,
    pathname: session.pathname,
    projectSlug: session.projectSlug,
    requestMode: session.requestMode,
    status,
    startedAt: new Date(Date.now() - (performance.now() - session.startedAt)).toISOString(),
    completedAt: new Date().toISOString(),
    totalMs: roundMs(performance.now() - session.startedAt),
    phases: Object.fromEntries(session.phases.entries()),
  };

  records.push(record);
  while (records.length > MAX_RECORDS) records.shift();

  return record;
}

function sanitizeMetricName(name: string): string {
  return name.replace(/[^A-Za-z0-9!#$%&'*+\-.^_`|~]/g, "_");
}

function formatDuration(value: number): string {
  return Math.max(0, roundMs(value)).toFixed(2);
}

export function buildServerTimingHeader(record: RequestProfileRecord): string {
  const metrics = [`total;dur=${formatDuration(record.totalMs)}`];

  for (const [name, duration] of Object.entries(record.phases).slice(0, 20)) {
    metrics.push(`${sanitizeMetricName(name)};dur=${formatDuration(duration)}`);
  }

  return metrics.join(", ");
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
    enabled: shouldEnableProfiling() || shouldEnableServerTiming(),
    last_sequence: sequence,
    records: [...records],
  };
}

export function resetRequestProfiles(): void {
  records.length = 0;
  sequence = 0;
}

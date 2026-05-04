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

function shouldProfilePath(pathname: string): boolean {
  return pathname.startsWith("/bench/") ||
    pathname.startsWith("/api/bench/") ||
    pathname.startsWith("/_vf_styles/") ||
    pathname.startsWith("/_vf_modules/");
}

export function isRequestProfilingEnabled(pathname?: string): boolean {
  if (!shouldEnableProfiling()) return false;
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

export function finalizeRequestProfiling(status?: number): void {
  const session = storage.getStore();
  if (!session) return;

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
}

export function snapshotRequestProfiles(): {
  enabled: boolean;
  last_sequence: number;
  records: RequestProfileRecord[];
} {
  return {
    enabled: shouldEnableProfiling(),
    last_sequence: sequence,
    records: [...records],
  };
}

export function resetRequestProfiles(): void {
  records.length = 0;
  sequence = 0;
}

import { getEnv } from "#veryfront/platform/compat/process.ts";

export interface ProxyServerTiming {
  enabled: boolean;
  startedAt: number;
  phases: Map<string, number>;
}

function roundMs(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatDuration(value: number): string {
  return Math.max(0, roundMs(value)).toFixed(2);
}

function sanitizeMetricName(name: string): string {
  return name.replace(/[^A-Za-z0-9!#$%&'*+\-.^_`|~]/g, "_");
}

export function shouldEnableProxyServerTiming(): boolean {
  return getEnv("VERYFRONT_ENABLE_PROXY_SERVER_TIMING") === "1" ||
    getEnv("VERYFRONT_ENABLE_SERVER_TIMING") === "1";
}

export function createProxyServerTiming(
  enabled = shouldEnableProxyServerTiming(),
): ProxyServerTiming {
  return {
    enabled,
    startedAt: performance.now(),
    phases: new Map(),
  };
}

export function markProxyServerTimingPhase(
  timing: ProxyServerTiming,
  name: string,
  durationMs = 0,
): void {
  if (!timing.enabled) return;
  timing.phases.set(name, roundMs((timing.phases.get(name) ?? 0) + durationMs));
}

export async function profileProxyServerTimingPhase<T>(
  timing: ProxyServerTiming,
  name: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (!timing.enabled) return await fn();

  const startedAt = performance.now();
  try {
    return await fn();
  } finally {
    markProxyServerTimingPhase(timing, name, performance.now() - startedAt);
  }
}

export function withProxyServerTimingHeader(
  response: Response,
  timing: ProxyServerTiming,
  totalMs = performance.now() - timing.startedAt,
): Response {
  if (!timing.enabled) return response;

  const metrics = [`proxy.total;dur=${formatDuration(totalMs)}`];
  for (const [name, duration] of timing.phases.entries()) {
    metrics.push(`${sanitizeMetricName(name)};dur=${formatDuration(duration)}`);
  }

  const value = metrics.join(", ");

  try {
    const existing = response.headers.get("Server-Timing");
    response.headers.set("Server-Timing", existing ? `${existing}, ${value}` : value);
    return response;
  } catch {
    const headers = new Headers(response.headers);
    const existing = headers.get("Server-Timing");
    headers.set("Server-Timing", existing ? `${existing}, ${value}` : value);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
}

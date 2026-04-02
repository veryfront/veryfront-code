import { join } from "#std/path";
import {
  getReportDir,
  getResultsDir,
  listJsonArtifacts,
  type RequestMode,
} from "../benchmarks/_shared_contract.ts";

export type BenchmarkFramework = "veryfront" | "nextjs";
export type BenchmarkRuntime = "production-host" | "preview-host";

export interface BrowserResultFile {
  generated_at: string;
  framework: string;
  runtime: string;
  project: string;
  request_mode?: RequestMode;
  results: Array<{
    scenario: string;
    runtime: string;
    project: string;
    request_mode?: RequestMode;
    url: string;
    status: number | null;
    metrics: Record<string, number | string | null>;
  }>;
}

export interface ServerResultFile {
  generated_at: string;
  framework: string;
  runtime: string;
  project: string;
  request_mode?: RequestMode;
  results: Array<{
    scenario: string;
    runtime: string;
    project: string;
    request_mode?: RequestMode;
    url: string;
    metrics: Record<string, number | string | null>;
  }>;
}

export interface PerfSummary {
  framework: string;
  runtime: string;
  project: string;
  score: number | null;
  metrics: Record<string, number | null>;
}

export interface PerfOverview {
  framework: string;
  runtime: string;
  project: string;
  score: number | null;
  cold: PerfSummary | null;
  warm: PerfSummary | null;
  metrics: Record<string, number | null>;
}

const OUTPUT_DIR = join("auto", "results");

function tail(text: string, lines = 80): string {
  return text.split("\n").slice(-lines).join("\n").trim();
}

function asNumber(value: number | string | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function getScenarioRow<
  T extends { scenario: string; metrics: Record<string, number | string | null> },
>(
  rows: T[],
  scenario: string,
): T | null {
  return rows.find((row) => row.scenario === scenario) ?? null;
}

function getMetric(
  rows: Array<{ scenario: string; metrics: Record<string, number | string | null> }>,
  scenario: string,
  key: string,
): number | null {
  const row = getScenarioRow(rows, scenario);
  return row ? asNumber(row.metrics[key]) : null;
}

export async function runTask(task: string, args: string[] = []): Promise<void> {
  const command = ["deno", "task", task, ...(args.length ? ["--", ...args] : [])].join(" ");
  console.log(`\n$ ${command}`);

  const process = new Deno.Command("deno", {
    args: ["task", task, ...(args.length ? ["--", ...args] : [])],
    stdout: "piped",
    stderr: "piped",
  });

  const { code, stdout, stderr } = await process.output();
  const out = new TextDecoder().decode(stdout);
  const err = new TextDecoder().decode(stderr);

  if (out.trim()) console.log(out.trim());
  if (err.trim()) console.error(err.trim());

  if (code !== 0) {
    throw new Error(
      `Command failed: ${command}\n${tail(`${out}\n${err}`)}`,
    );
  }
}

export async function loadLatestResult<
  T extends { framework: string; runtime: string; project: string; request_mode?: RequestMode },
>(
  kind: "browser" | "server",
  framework: BenchmarkFramework,
  runtime: string,
  project: string,
  requestMode: RequestMode = "cold",
): Promise<T | null> {
  const files = await listJsonArtifacts(getResultsDir(kind));
  for (const filePath of [...files].reverse()) {
    const parsed = JSON.parse(await Deno.readTextFile(filePath)) as T;
    if (
      parsed.framework === framework &&
      parsed.runtime === runtime &&
      parsed.project === project &&
      (parsed.request_mode ?? "cold") === requestMode
    ) {
      return parsed;
    }
  }
  return null;
}

export async function loadLatestCompareReport(
  runtime: string,
  project: string,
): Promise<Record<string, unknown> | null> {
  const reportDir = getReportDir();
  const files = await listJsonArtifacts(reportDir);
  const prefix = `compare-local-${runtime}-${project}-`;
  for (const filePath of [...files].reverse()) {
    if (!filePath.includes(prefix)) continue;
    return JSON.parse(await Deno.readTextFile(filePath)) as Record<string, unknown>;
  }
  return null;
}

export function summarizePerf(
  browser: BrowserResultFile,
  server: ServerResultFile,
  baseline?: { browser?: BrowserResultFile | null; server?: ServerResultFile | null },
): PerfSummary {
  const metrics: Record<string, number | null> = {
    browser_static_ttfb_ms: getMetric(browser.results, "static_route", "ttfb_ms"),
    browser_static_lcp_ms: getMetric(browser.results, "static_route", "lcp_ms"),
    browser_ssr_data_ttfb_ms: getMetric(browser.results, "ssr_data_route", "ttfb_ms"),
    browser_interactive_ttfb_ms: getMetric(
      browser.results,
      "interactive_hydrated_route",
      "ttfb_ms",
    ),
    browser_interactive_lcp_ms: getMetric(browser.results, "interactive_hydrated_route", "lcp_ms"),
    browser_interactive_inp_ms: getMetric(browser.results, "interactive_hydrated_route", "inp_ms"),
    browser_interactive_tbt_ms: getMetric(browser.results, "interactive_hydrated_route", "tbt_ms"),
    browser_interactive_response_bytes: getMetric(
      browser.results,
      "interactive_hydrated_route",
      "response_bytes",
    ),
    server_interactive_p50_ms: getMetric(
      server.results,
      "interactive_hydrated_route",
      "latency_p50_ms",
    ),
    server_interactive_p95_ms: getMetric(
      server.results,
      "interactive_hydrated_route",
      "latency_p95_ms",
    ),
    server_interactive_p99_ms: getMetric(
      server.results,
      "interactive_hydrated_route",
      "latency_p99_ms",
    ),
    server_interactive_rps: getMetric(
      server.results,
      "interactive_hydrated_route",
      "requests_per_second",
    ),
    server_api_p95_ms: getMetric(server.results, "api_route", "latency_p95_ms"),
    server_api_rps: getMetric(server.results, "api_route", "requests_per_second"),
  };

  if (baseline?.browser) {
    metrics.browser_static_ttfb_delta_vs_nextjs_ms = subtract(
      metrics.browser_static_ttfb_ms ?? null,
      getMetric(baseline.browser.results, "static_route", "ttfb_ms"),
    );
    metrics.browser_interactive_ttfb_delta_vs_nextjs_ms = subtract(
      metrics.browser_interactive_ttfb_ms ?? null,
      getMetric(baseline.browser.results, "interactive_hydrated_route", "ttfb_ms"),
    );
    metrics.browser_interactive_lcp_delta_vs_nextjs_ms = subtract(
      metrics.browser_interactive_lcp_ms ?? null,
      getMetric(baseline.browser.results, "interactive_hydrated_route", "lcp_ms"),
    );
    metrics.browser_interactive_bytes_delta_vs_nextjs = subtract(
      metrics.browser_interactive_response_bytes ?? null,
      getMetric(baseline.browser.results, "interactive_hydrated_route", "response_bytes"),
    );
  }

  if (baseline?.server) {
    metrics.server_interactive_p95_delta_vs_nextjs_ms = subtract(
      metrics.server_interactive_p95_ms ?? null,
      getMetric(baseline.server.results, "interactive_hydrated_route", "latency_p95_ms"),
    );
    metrics.server_api_rps_delta_vs_nextjs = subtract(
      metrics.server_api_rps ?? null,
      getMetric(baseline.server.results, "api_route", "requests_per_second"),
    );
  }

  const browserStaticTtfb = metrics.browser_static_ttfb_ms ?? null;
  const browserInteractiveLcp = metrics.browser_interactive_lcp_ms ?? null;
  const serverInteractiveP95 = metrics.server_interactive_p95_ms ?? null;

  const score = sum([
    browserStaticTtfb,
    browserInteractiveLcp,
    serverInteractiveP95,
  ]);

  return {
    framework: browser.framework,
    runtime: browser.runtime,
    project: browser.project,
    score,
    metrics,
  };
}

export function summarizePerfOverview(
  current: {
    cold?: { browser?: BrowserResultFile | null; server?: ServerResultFile | null };
    warm?: { browser?: BrowserResultFile | null; server?: ServerResultFile | null };
  },
  baseline?: {
    cold?: { browser?: BrowserResultFile | null; server?: ServerResultFile | null };
    warm?: { browser?: BrowserResultFile | null; server?: ServerResultFile | null };
  },
): PerfOverview {
  const cold = current.cold?.browser && current.cold?.server
    ? summarizePerf(current.cold.browser, current.cold.server, baseline?.cold)
    : null;
  const warm = current.warm?.browser && current.warm?.server
    ? summarizePerf(current.warm.browser, current.warm.server, baseline?.warm)
    : null;

  const framework = cold?.framework ?? warm?.framework ?? "veryfront";
  const runtime = cold?.runtime ?? warm?.runtime ?? "unknown";
  const project = cold?.project ?? warm?.project ?? "unknown";

  const metrics: Record<string, number | null> = {
    cold_score: cold?.score ?? null,
    warm_score: warm?.score ?? null,
    ...prefixMetrics("cold", cold?.metrics),
    ...prefixMetrics("warm", warm?.metrics),
    browser_static_ttfb_improvement_from_cold_ms: improvement(
      cold?.metrics.browser_static_ttfb_ms ?? null,
      warm?.metrics.browser_static_ttfb_ms ?? null,
    ),
    browser_static_ttfb_improvement_from_cold_pct: improvementPercent(
      cold?.metrics.browser_static_ttfb_ms ?? null,
      warm?.metrics.browser_static_ttfb_ms ?? null,
    ),
    browser_interactive_ttfb_improvement_from_cold_ms: improvement(
      cold?.metrics.browser_interactive_ttfb_ms ?? null,
      warm?.metrics.browser_interactive_ttfb_ms ?? null,
    ),
    browser_interactive_ttfb_improvement_from_cold_pct: improvementPercent(
      cold?.metrics.browser_interactive_ttfb_ms ?? null,
      warm?.metrics.browser_interactive_ttfb_ms ?? null,
    ),
    browser_interactive_lcp_improvement_from_cold_ms: improvement(
      cold?.metrics.browser_interactive_lcp_ms ?? null,
      warm?.metrics.browser_interactive_lcp_ms ?? null,
    ),
    browser_interactive_lcp_improvement_from_cold_pct: improvementPercent(
      cold?.metrics.browser_interactive_lcp_ms ?? null,
      warm?.metrics.browser_interactive_lcp_ms ?? null,
    ),
    server_interactive_p95_improvement_from_cold_ms: improvement(
      cold?.metrics.server_interactive_p95_ms ?? null,
      warm?.metrics.server_interactive_p95_ms ?? null,
    ),
    server_interactive_p95_improvement_from_cold_pct: improvementPercent(
      cold?.metrics.server_interactive_p95_ms ?? null,
      warm?.metrics.server_interactive_p95_ms ?? null,
    ),
    server_api_p95_improvement_from_cold_ms: improvement(
      cold?.metrics.server_api_p95_ms ?? null,
      warm?.metrics.server_api_p95_ms ?? null,
    ),
    server_api_p95_improvement_from_cold_pct: improvementPercent(
      cold?.metrics.server_api_p95_ms ?? null,
      warm?.metrics.server_api_p95_ms ?? null,
    ),
  };

  return {
    framework,
    runtime,
    project,
    score: sum([cold?.score ?? null, warm?.score ?? null]),
    cold,
    warm,
    metrics,
  };
}

function subtract(left: number | null, right: number | null): number | null {
  if (left == null || right == null) return null;
  return round(left - right);
}

function improvement(cold: number | null, warm: number | null): number | null {
  if (cold == null || warm == null) return null;
  return round(cold - warm);
}

function improvementPercent(cold: number | null, warm: number | null): number | null {
  if (cold == null || warm == null || cold === 0) return null;
  return round(((cold - warm) / cold) * 100);
}

function sum(values: Array<number | null>): number | null {
  if (values.some((value) => value == null)) return null;
  return round(values.reduce<number>((total, value) => total + (value ?? 0), 0));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export function printMetricLines(summary: PerfSummary): void {
  const keys = Object.keys(summary.metrics).sort();
  if (summary.score != null) {
    console.log(`METRIC score=${summary.score}`);
  }
  for (const key of keys) {
    const value = summary.metrics[key];
    if (value == null) continue;
    console.log(`METRIC ${key}=${value}`);
  }
}

function prefixMetrics(
  prefix: string,
  metrics: Record<string, number | null> | undefined,
): Record<string, number | null> {
  if (!metrics) return {};
  return Object.fromEntries(
    Object.entries(metrics).map(([key, value]) => [`${prefix}_${key}`, value]),
  );
}

export async function writeAutoResult(name: string, data: unknown): Promise<string> {
  await Deno.mkdir(OUTPUT_DIR, { recursive: true });
  const path = join(OUTPUT_DIR, `${name.replace(/[^a-zA-Z0-9._-]+/g, "-")}.json`);
  await Deno.writeTextFile(path, JSON.stringify(data, null, 2));
  return path;
}

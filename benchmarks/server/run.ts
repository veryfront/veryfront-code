import {
  getBooleanFlag,
  getIntegerFlag,
  getRequestModeFlag,
  getScenarioPath,
  getStringFlag,
  loadBenchmarkContract,
  type ProfilingSnapshot,
  summarizeProfilingDelta,
  writeBenchmarkResult,
} from "../_shared_contract.ts";
import { getRuntimeForPlaywrightProject } from "../../tests/e2e/helpers/runtime.ts";
import { type BenchmarkFramework, startBenchmarkServer } from "../_framework_server.ts";

const FRAMEWORK = (getStringFlag("framework") ?? "veryfront") as BenchmarkFramework;
const DEFAULT_RUNTIME = getStringFlag("runtime") ??
  (Deno.env.get("PLAYWRIGHT_PROJECT")?.trim() || "production-host");
const PROJECT_SLUG = getStringFlag("project") ??
  (Deno.env.get("BENCH_PROJECT")?.trim() || "blank");
const REQUESTS = getIntegerFlag("requests") ??
  Number.parseInt(Deno.env.get("BENCH_REQUESTS") ?? "25", 10);
const CONCURRENCY = getIntegerFlag("concurrency") ??
  Number.parseInt(Deno.env.get("BENCH_CONCURRENCY") ?? "5", 10);
const REQUEST_MODE = getRequestModeFlag();
const ENABLE_PROFILING = getBooleanFlag("profiling", false);
const RUN_ID = new Date().toISOString().replace(/[:.]/g, "-");

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] ?? null;
}

async function runScenario(url: string, totalRequests: number, concurrency: number) {
  const latencies: number[] = [];
  let failures = 0;
  let bytes = 0;
  let completed = 0;
  const startedAt = performance.now();

  async function worker() {
    while (completed < totalRequests) {
      const current = completed++;
      if (current >= totalRequests) break;

      const started = performance.now();
      try {
        const response = await fetch(url);
        const body = new Uint8Array(await response.arrayBuffer());
        bytes += body.byteLength;
        if (!response.ok) failures += 1;
      } catch {
        failures += 1;
      }
      latencies.push(performance.now() - started);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  const totalDuration = performance.now() - startedAt;
  const sorted = [...latencies].sort((a, b) => a - b);

  return {
    latency_p50_ms: percentile(sorted, 50),
    latency_p95_ms: percentile(sorted, 95),
    latency_p99_ms: percentile(sorted, 99),
    requests_per_second: totalDuration > 0 ? (latencies.length / totalDuration) * 1000 : null,
    error_rate: totalRequests > 0 ? failures / totalRequests : null,
    response_bytes: latencies.length > 0 ? Math.round(bytes / latencies.length) : null,
    requests: totalRequests,
    concurrency,
  };
}

async function warmScenario(url: string): Promise<void> {
  const response = await fetch(url);
  await response.arrayBuffer();
}

async function fetchProfilingSnapshot(baseUrl: string): Promise<ProfilingSnapshot | null> {
  if (FRAMEWORK !== "veryfront") return null;

  try {
    const response = await fetch(new URL("/_metrics", baseUrl));
    const payload = await response.json() as { profiling?: ProfilingSnapshot };
    return payload.profiling ?? null;
  } catch {
    return null;
  }
}

async function main() {
  const contract = await loadBenchmarkContract();
  const runtime = getRuntimeForPlaywrightProject(DEFAULT_RUNTIME);
  const server = await startBenchmarkServer({
    framework: FRAMEWORK,
    projectSlug: PROJECT_SLUG,
    environment: runtime.modeName,
    enableProfiling: ENABLE_PROFILING,
  });

  try {
    const baseUrl = runtime.getUrl(PROJECT_SLUG);
    const metricsBefore = FRAMEWORK === "veryfront"
      ? await fetch(new URL("/_metrics", baseUrl)).then((res) => res.json()).catch(() => null)
      : null;
    const results: Array<Record<string, unknown>> = [];

    for (const scenario of contract.scenarios) {
      const url = getScenarioPath(baseUrl, scenario, {
        forceProductionScripts: FRAMEWORK === "veryfront",
      });
      const beforeProfiling = await fetchProfilingSnapshot(baseUrl);
      if (REQUEST_MODE === "warm") {
        await warmScenario(url);
      }
      const summary = await runScenario(url, REQUESTS, CONCURRENCY);
      const afterProfiling = await fetchProfilingSnapshot(baseUrl);
      const profilingRecords = afterProfiling
        ? afterProfiling.records.filter((record) =>
          record.sequence > (beforeProfiling?.last_sequence ?? 0)
        )
        : [];
      results.push({
        scenario: scenario.id,
        runtime: runtime.name,
        project: PROJECT_SLUG,
        request_mode: REQUEST_MODE,
        url,
        metrics: summary,
        profiling: summarizeProfilingDelta(profilingRecords),
      });
    }

    const metricsAfter = FRAMEWORK === "veryfront"
      ? await fetch(new URL("/_metrics", baseUrl)).then((res) => res.json()).catch(() => null)
      : null;

    const output = await writeBenchmarkResult(
      "server",
      `server-${FRAMEWORK}-${runtime.name}-${PROJECT_SLUG}-${REQUEST_MODE}-${RUN_ID}`,
      {
        generated_at: new Date().toISOString(),
        framework: FRAMEWORK,
        runtime: runtime.name,
        project: PROJECT_SLUG,
        request_mode: REQUEST_MODE,
        profiling_enabled: ENABLE_PROFILING,
        metrics_before: metricsBefore,
        metrics_after: metricsAfter,
        results,
      },
    );

    console.log(`Wrote server benchmark results to ${output}`);
  } finally {
    await server.stop();
  }
}

if (import.meta.main) {
  try {
    await main();
    Deno.exit(0);
  } catch (error) {
    console.error(error);
    Deno.exit(1);
  }
}

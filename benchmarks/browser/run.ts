import { chromium, type Page } from "npm:playwright@1.59.0";
import {
  getBooleanFlag,
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
import { setupErrorCollection } from "../../tests/e2e/helpers/assertions.ts";

const FRAMEWORK = (getStringFlag("framework") ?? "veryfront") as BenchmarkFramework;
const DEFAULT_RUNTIME = getStringFlag("runtime") ??
  (Deno.env.get("PLAYWRIGHT_PROJECT")?.trim() || "production-host");
const PROJECT_SLUG = getStringFlag("project") ??
  (Deno.env.get("BENCH_PROJECT")?.trim() || "blank");
const REQUEST_MODE = getRequestModeFlag();
const ENABLE_PROFILING = getBooleanFlag("profiling", false);
const RUN_ID = new Date().toISOString().replace(/[:.]/g, "-");

function ms(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
}

function assertNoBrowserErrors(scenarioId: string, errors: string[]): void {
  if (errors.length === 0) return;
  throw new Error(
    `Benchmark scenario "${scenarioId}" produced browser errors:\n${errors.join("\n")}`,
  );
}

async function collectScenarioMetrics(page: Page) {
  return await page.evaluate(() => {
    const bag = (window as typeof window & {
      __vfBench?: { lcp: number | null; cls: number; longTasks: number[]; inpDurations: number[] };
    }).__vfBench;

    const nav = performance.getEntriesByType("navigation")[0] as
      | PerformanceNavigationTiming
      | undefined;
    const paints = performance.getEntriesByType("paint");
    const fcp = paints.find((entry) => entry.name === "first-contentful-paint")?.startTime ?? null;
    const lcp = bag?.lcp ?? null;
    const cls = bag?.cls ?? 0;
    const longTasks = bag?.longTasks ?? [];
    const inpDurations = bag?.inpDurations ?? [];
    const inp = inpDurations.length > 0 ? Math.max(...inpDurations) : null;
    const tbt = longTasks.reduce((sum, duration) => sum + Math.max(0, duration - 50), 0);

    return {
      ttfb_ms: nav ? nav.responseStart : null,
      fcp_ms: fcp,
      lcp_ms: lcp,
      cls,
      inp_ms: inp,
      tbt_ms: tbt,
      dom_content_loaded_ms: nav ? nav.domContentLoadedEventEnd : null,
      load_event_end_ms: nav ? nav.loadEventEnd : null,
      response_bytes: new TextEncoder().encode(document.documentElement.outerHTML).byteLength,
    };
  });
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

async function warmScenarioCache(
  page: Page,
  url: string,
  requiresHydration: boolean,
): Promise<void> {
  await page.goto(url, { waitUntil: "networkidle" });

  if (requiresHydration) {
    const button = page.locator("#bench-interactive-button");
    if (await button.count()) {
      await button.click();
      await page.waitForTimeout(250);
    }
  }
}

async function withBenchmarkServer<T>(
  environment: "preview" | "production",
  fn: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const server = await startBenchmarkServer({
    framework: FRAMEWORK,
    projectSlug: PROJECT_SLUG,
    environment,
    enableProfiling: ENABLE_PROFILING,
  });

  try {
    return await fn(getRuntimeForPlaywrightProject(DEFAULT_RUNTIME).getUrl(PROJECT_SLUG));
  } finally {
    await server.stop();
  }
}

async function measureScenario(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  baseUrl: string,
  runtimeName: string,
  scenario: (Awaited<ReturnType<typeof loadBenchmarkContract>>)["scenarios"][number],
): Promise<Record<string, unknown>> {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    (window as typeof window & {
      __vfBench?: {
        lcp: number | null;
        cls: number;
        longTasks: number[];
        inpDurations: number[];
      };
    }).__vfBench = { lcp: null, cls: 0, longTasks: [], inpDurations: [] };

    new PerformanceObserver((entryList) => {
      for (const entry of entryList.getEntries()) {
        (window as typeof window & { __vfBench: { lcp: number | null } }).__vfBench.lcp =
          entry.startTime;
      }
    }).observe({ type: "largest-contentful-paint", buffered: true });

    new PerformanceObserver((entryList) => {
      for (
        const entry of entryList.getEntries() as Array<
          PerformanceEntry & { hadRecentInput?: boolean; value?: number }
        >
      ) {
        if (!entry.hadRecentInput) {
          (window as typeof window & { __vfBench: { cls: number } }).__vfBench.cls += entry.value ??
            0;
        }
      }
    }).observe({ type: "layout-shift", buffered: true });

    new PerformanceObserver((entryList) => {
      for (const entry of entryList.getEntries()) {
        (window as typeof window & { __vfBench: { longTasks: number[] } }).__vfBench.longTasks
          .push(entry.duration);
      }
    }).observe({ type: "longtask", buffered: true });

    new PerformanceObserver((entryList) => {
      for (const entry of entryList.getEntries()) {
        const typed = entry as PerformanceEntry & { interactionId?: number };
        if ((typed.interactionId ?? 0) > 0) {
          (window as typeof window & { __vfBench: { inpDurations: number[] } }).__vfBench
            .inpDurations.push(entry.duration);
        }
      }
    }).observe(
      { type: "event", buffered: true, durationThreshold: 16 } as PerformanceObserverInit & {
        durationThreshold: number;
      },
    );
  });

  try {
    const page = await context.newPage();
    const errors = setupErrorCollection(page);
    const url = getScenarioPath(baseUrl, scenario, {
      forceProductionScripts: FRAMEWORK === "veryfront",
    });
    const beforeProfiling = await fetchProfilingSnapshot(baseUrl);

    if (REQUEST_MODE === "warm") {
      await warmScenarioCache(page, url, scenario.requirements.hydration);
      await page.close();
    }

    const measuredPage = REQUEST_MODE === "warm" ? await context.newPage() : page;
    const measuredErrors = REQUEST_MODE === "warm" ? setupErrorCollection(measuredPage) : errors;
    const response = await measuredPage.goto(url, { waitUntil: "networkidle" });

    if (scenario.requirements.hydration) {
      const button = measuredPage.locator("#bench-interactive-button");
      if (await button.count()) {
        await button.click();
        await measuredPage.waitForTimeout(250);
      }
    }

    const metrics = await collectScenarioMetrics(measuredPage);
    const afterProfiling = await fetchProfilingSnapshot(baseUrl);
    const profilingRecords = afterProfiling
      ? afterProfiling.records.filter((record) =>
        record.sequence > (beforeProfiling?.last_sequence ?? 0)
      )
      : [];
    assertNoBrowserErrors(scenario.id, measuredErrors);

    return {
      scenario: scenario.id,
      runtime: runtimeName,
      project: PROJECT_SLUG,
      request_mode: REQUEST_MODE,
      url,
      status: response?.status() ?? null,
      metrics: Object.fromEntries(
        Object.entries(metrics).map(([key, value]) => [key, ms(value) ?? value]),
      ),
      profiling: summarizeProfilingDelta(profilingRecords),
    };
  } finally {
    await context.close();
  }
}

async function main() {
  const contract = await loadBenchmarkContract();
  const runtime = getRuntimeForPlaywrightProject(DEFAULT_RUNTIME);
  const browser = await chromium.launch({ headless: true });

  try {
    const results: Array<Record<string, unknown>> = [];

    for (
      const scenario of contract.scenarios.filter((item) => item.kind === "browser_and_server")
    ) {
      results.push(
        await withBenchmarkServer(
          runtime.modeName,
          (baseUrl) => measureScenario(browser, baseUrl, runtime.name, scenario),
        ),
      );
    }

    const summary = {
      generated_at: new Date().toISOString(),
      framework: FRAMEWORK,
      runtime: runtime.name,
      project: PROJECT_SLUG,
      request_mode: REQUEST_MODE,
      profiling_enabled: ENABLE_PROFILING,
      results,
    };

    const output = await writeBenchmarkResult(
      "browser",
      `browser-${FRAMEWORK}-${runtime.name}-${PROJECT_SLUG}-${REQUEST_MODE}-${RUN_ID}`,
      summary,
    );
    console.log(`Wrote browser benchmark results to ${output}`);
  } finally {
    await browser.close();
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

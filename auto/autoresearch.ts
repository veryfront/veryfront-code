import { parseArgs } from "#std/flags";
import {
  type BenchmarkRuntime,
  type BrowserResultFile,
  loadLatestCompareReport,
  loadLatestResult,
  type PerfOverview,
  printMetricLines,
  runTask,
  type ServerResultFile,
  summarizePerfOverview,
  writeAutoResult,
} from "./_lib.ts";
import type { RequestMode } from "../benchmarks/_shared_contract.ts";

const rawArgs = Deno.args[0] === "--" ? Deno.args.slice(1) : Deno.args;

const flags = parseArgs(rawArgs, {
  string: ["runtime", "project"],
  boolean: ["skip-verify", "refresh-baseline"],
  default: {
    runtime: "production-host",
    project: "blank",
    runs: 3,
    "skip-verify": false,
    "refresh-baseline": false,
  },
});

const runtime = String(flags.runtime) as BenchmarkRuntime;
const project = String(flags.project);
const skipVerify = Boolean(flags["skip-verify"]);
const refreshBaseline = Boolean(flags["refresh-baseline"]);
const requestedRuns = typeof flags.runs === "number" ? flags.runs : Number(flags.runs ?? 3);
const runs = Number.isFinite(requestedRuns) && requestedRuns > 0 ? Math.floor(requestedRuns) : 3;
const runId = new Date().toISOString().replace(/[:.]/g, "-");

async function ensureBaseline(): Promise<{
  cold: { browser: BrowserResultFile | null; server: ServerResultFile | null };
  warm: { browser: BrowserResultFile | null; server: ServerResultFile | null };
}> {
  const modes: RequestMode[] = ["cold", "warm"];
  let coldBrowser = await loadLatestResult<BrowserResultFile>(
    "browser",
    "nextjs",
    runtime,
    project,
    "cold",
  );
  let coldServer = await loadLatestResult<ServerResultFile>(
    "server",
    "nextjs",
    runtime,
    project,
    "cold",
  );
  let warmBrowser = await loadLatestResult<BrowserResultFile>(
    "browser",
    "nextjs",
    runtime,
    project,
    "warm",
  );
  let warmServer = await loadLatestResult<ServerResultFile>(
    "server",
    "nextjs",
    runtime,
    project,
    "warm",
  );

  if (refreshBaseline || !coldBrowser || !coldServer || !warmBrowser || !warmServer) {
    console.log("Refreshing Next.js baseline artifacts for comparison...");
    await runBenchPair(
      "nextjs",
      refreshBaseline
        ? modes
        : modes.filter((mode) =>
          mode === "cold" ? (!coldBrowser || !coldServer) : (!warmBrowser || !warmServer)
        ),
    );
    coldBrowser = await loadLatestResult<BrowserResultFile>(
      "browser",
      "nextjs",
      runtime,
      project,
      "cold",
    );
    coldServer = await loadLatestResult<ServerResultFile>(
      "server",
      "nextjs",
      runtime,
      project,
      "cold",
    );
    warmBrowser = await loadLatestResult<BrowserResultFile>(
      "browser",
      "nextjs",
      runtime,
      project,
      "warm",
    );
    warmServer = await loadLatestResult<ServerResultFile>(
      "server",
      "nextjs",
      runtime,
      project,
      "warm",
    );
  }

  return {
    cold: { browser: coldBrowser, server: coldServer },
    warm: { browser: warmBrowser, server: warmServer },
  };
}

async function verify(): Promise<void> {
  if (skipVerify) return;
  await runTask("typecheck");
  await runTask("test:e2e:playwright");
}

async function runBenchPair(
  framework: "veryfront" | "nextjs",
  requestModes: RequestMode[] = ["cold", "warm"],
): Promise<void> {
  for (const requestMode of requestModes) {
    await runTask("bench:browser", [
      "--framework",
      framework,
      "--runtime",
      runtime,
      "--project",
      project,
      "--request-mode",
      requestMode,
    ]);
    await runTask("bench:server", [
      "--framework",
      framework,
      "--runtime",
      runtime,
      "--project",
      project,
      "--request-mode",
      requestMode,
    ]);
  }
}

async function captureVeryfrontRun(index: number, baseline: {
  cold: { browser: BrowserResultFile | null; server: ServerResultFile | null };
  warm: { browser: BrowserResultFile | null; server: ServerResultFile | null };
}): Promise<PerfOverview> {
  console.log(`\n=== Autoresearch run ${index}/${runs} ===`);
  await runBenchPair("veryfront");

  const [coldBrowser, coldServer, warmBrowser, warmServer] = await Promise.all([
    loadLatestResult<BrowserResultFile>("browser", "veryfront", runtime, project, "cold"),
    loadLatestResult<ServerResultFile>("server", "veryfront", runtime, project, "cold"),
    loadLatestResult<BrowserResultFile>("browser", "veryfront", runtime, project, "warm"),
    loadLatestResult<ServerResultFile>("server", "veryfront", runtime, project, "warm"),
  ]);

  if (!coldBrowser || !coldServer || !warmBrowser || !warmServer) {
    throw new Error(`Missing Veryfront benchmark artifacts after run ${index}`);
  }

  const summary = summarizePerfOverview(
    {
      cold: { browser: coldBrowser, server: coldServer },
      warm: { browser: warmBrowser, server: warmServer },
    },
    baseline,
  );
  console.log(
    `run=${index} score=${summary.score ?? "—"} cold_static_ttfb=${
      summary.metrics.cold_browser_static_ttfb_ms ?? "—"
    } warm_interactive_ttfb=${
      summary.metrics.warm_browser_interactive_ttfb_ms ?? "—"
    } warm_interactive_lcp=${
      summary.metrics.warm_browser_interactive_lcp_ms ?? "—"
    } warm_server_p95=${summary.metrics.warm_server_interactive_p95_ms ?? "—"}`,
  );
  return summary;
}

function chooseBestRun(summaries: PerfOverview[]): PerfOverview {
  return summaries.reduce((best, current) => {
    if (best.score == null) return current;
    if (current.score == null) return best;
    return current.score < best.score ? current : best;
  });
}

async function main() {
  console.log(`Running Veryfront autoresearch loop for ${runtime}/${project} (${runs} runs)`);
  await verify();
  const baseline = await ensureBaseline();

  const summaries: PerfOverview[] = [];
  for (let index = 1; index <= runs; index += 1) {
    summaries.push(await captureVeryfrontRun(index, baseline));
  }

  const best = chooseBestRun(summaries);
  await runTask("bench:compare:local", ["--runtime", runtime, "--project", project]);
  const compare = await loadLatestCompareReport(runtime, project);

  const artifact = await writeAutoResult(`autoresearch-${runtime}-${project}-${runId}`, {
    generated_at: new Date().toISOString(),
    runtime,
    project,
    runs,
    best,
    all_runs: summaries,
    compare_report_generated_at: compare?.generated_at ?? null,
  });

  console.log(`\nBest run artifact: ${artifact}`);
  console.log(`Best run score: ${best.score ?? "—"}`);
  printMetricLines(best);
}

await main();

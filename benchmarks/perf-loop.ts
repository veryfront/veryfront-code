import {
  type BrowserResultFile,
  ensureNextBaseline,
  loadFrameworkArtifacts,
  loadLatestCompareReport,
  parsePerfCliFlags,
  type PerfOverview,
  printMetricLines,
  runBenchmarkPair,
  runTask,
  type ServerResultFile,
  summarizePerfOverview,
  verifyPerfPrerequisites,
  writePerfArtifact,
} from "./_perf_lib.ts";

const rawArgs = Deno.args[0] === "--" ? Deno.args.slice(1) : Deno.args;
const { runtime, project, skipVerify, refreshBaseline } = parsePerfCliFlags(rawArgs);
const parsedRuns = parseInt(
  String(
    (rawArgs.find((arg) => arg.startsWith("--runs="))?.split("=")[1]) ??
      rawArgs[rawArgs.indexOf("--runs") + 1] ?? 3,
  ),
  10,
);
const requestedRuns = Number.isFinite(parsedRuns) ? parsedRuns : 3;
const runs = Number.isFinite(requestedRuns) && requestedRuns > 0 ? Math.floor(requestedRuns) : 3;
const runId = new Date().toISOString().replace(/[:.]/g, "-");

async function captureVeryfrontRun(index: number, baseline: {
  cold: { browser: BrowserResultFile | null; server: ServerResultFile | null };
  warm: { browser: BrowserResultFile | null; server: ServerResultFile | null };
}): Promise<PerfOverview> {
  console.log(`\n=== Perf loop run ${index}/${runs} ===`);
  await runBenchmarkPair("veryfront", runtime, project);

  const current = await loadFrameworkArtifacts("veryfront", runtime, project);
  if (
    !current.cold.browser || !current.cold.server || !current.warm.browser || !current.warm.server
  ) {
    throw new Error(`Missing Veryfront benchmark artifacts after run ${index}`);
  }

  const summary = summarizePerfOverview(current, baseline);
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
  console.log(`Running Veryfront perf loop for ${runtime}/${project} (${runs} runs)`);
  await verifyPerfPrerequisites(skipVerify);
  const baseline = await ensureNextBaseline(runtime, project, refreshBaseline);

  const summaries: PerfOverview[] = [];
  for (let index = 1; index <= runs; index += 1) {
    summaries.push(await captureVeryfrontRun(index, baseline));
  }

  const best = chooseBestRun(summaries);
  await runTask("bench:compare:local", ["--runtime", runtime, "--project", project]);
  const compare = await loadLatestCompareReport(runtime, project);

  const artifact = await writePerfArtifact(`perf-loop-${runtime}-${project}-${runId}`, {
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

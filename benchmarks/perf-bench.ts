import {
  ensureNextBaseline,
  loadFrameworkArtifacts,
  loadLatestCompareReport,
  parsePerfCliFlags,
  printMetricLines,
  runBenchmarkPair,
  runTask,
  summarizePerfOverview,
  verifyPerfPrerequisites,
  writePerfArtifact,
} from "./_perf_lib.ts";

const { runtime, project, skipVerify, refreshBaseline } = parsePerfCliFlags(Deno.args);
const runId = new Date().toISOString().replace(/[:.]/g, "-");

async function main() {
  console.log(`Running Veryfront perf bench for ${runtime}/${project}`);
  await verifyPerfPrerequisites(skipVerify);
  const baseline = await ensureNextBaseline(runtime, project, refreshBaseline);

  await runBenchmarkPair("veryfront", runtime, project);
  await runTask("bench:compare:local", ["--runtime", runtime, "--project", project]);
  const current = await loadFrameworkArtifacts("veryfront", runtime, project);
  const compare = await loadLatestCompareReport(runtime, project);

  const summary = summarizePerfOverview(current, baseline);

  const artifact = await writePerfArtifact(`perf-bench-${runtime}-${project}-${runId}`, {
    generated_at: new Date().toISOString(),
    runtime,
    project,
    summary,
    compare_report_generated_at: compare?.generated_at ?? null,
  });

  console.log(`\nSummary artifact: ${artifact}`);
  printMetricLines(summary);
}

await main();

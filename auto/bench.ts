import { parseArgs } from "#std/flags";
import {
  type BenchmarkRuntime,
  type BrowserResultFile,
  loadLatestCompareReport,
  loadLatestResult,
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
    "skip-verify": false,
    "refresh-baseline": false,
  },
});

const runtime = String(flags.runtime) as BenchmarkRuntime;
const project = String(flags.project);
const skipVerify = Boolean(flags["skip-verify"]);
const refreshBaseline = Boolean(flags["refresh-baseline"]);
const runId = new Date().toISOString().replace(/[:.]/g, "-");

async function ensureBaseline(): Promise<void> {
  const modes: RequestMode[] = ["cold", "warm"];
  const missingModes: RequestMode[] = [];

  for (const requestMode of modes) {
    const browser = await loadLatestResult<BrowserResultFile>(
      "browser",
      "nextjs",
      runtime,
      project,
      requestMode,
    );
    const server = await loadLatestResult<ServerResultFile>(
      "server",
      "nextjs",
      runtime,
      project,
      requestMode,
    );

    if (!browser || !server) missingModes.push(requestMode);
  }

  if (!refreshBaseline && missingModes.length === 0) return;

  console.log("Refreshing Next.js baseline artifacts...");
  await runBenchPair("nextjs", refreshBaseline ? modes : missingModes);
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

async function main() {
  console.log(`Running Veryfront perf bench for ${runtime}/${project}`);
  await verify();
  await ensureBaseline();

  await runBenchPair("veryfront");
  await runTask("bench:compare:local", ["--runtime", runtime, "--project", project]);

  const [coldBaselineBrowser, coldBaselineServer, warmBaselineBrowser, warmBaselineServer] =
    await Promise.all([
      loadLatestResult<BrowserResultFile>("browser", "nextjs", runtime, project, "cold"),
      loadLatestResult<ServerResultFile>("server", "nextjs", runtime, project, "cold"),
      loadLatestResult<BrowserResultFile>("browser", "nextjs", runtime, project, "warm"),
      loadLatestResult<ServerResultFile>("server", "nextjs", runtime, project, "warm"),
    ]);
  const compare = await loadLatestCompareReport(runtime, project);

  const summary = summarizePerfOverview(
    {
      cold: {
        browser: await loadLatestResult<BrowserResultFile>(
          "browser",
          "veryfront",
          runtime,
          project,
          "cold",
        ),
        server: await loadLatestResult<ServerResultFile>(
          "server",
          "veryfront",
          runtime,
          project,
          "cold",
        ),
      },
      warm: {
        browser: await loadLatestResult<BrowserResultFile>(
          "browser",
          "veryfront",
          runtime,
          project,
          "warm",
        ),
        server: await loadLatestResult<ServerResultFile>(
          "server",
          "veryfront",
          runtime,
          project,
          "warm",
        ),
      },
    },
    {
      cold: { browser: coldBaselineBrowser, server: coldBaselineServer },
      warm: { browser: warmBaselineBrowser, server: warmBaselineServer },
    },
  );

  const artifact = await writeAutoResult(`bench-${runtime}-${project}-${runId}`, {
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

import { join } from "#std/path";
import {
  BENCHMARKS_ROOT,
  getReportDir,
  getResultsDir,
  getStringFlag,
  listJsonArtifacts,
  loadBenchmarkContract,
  writeReportArtifact,
} from "../_shared_contract.ts";

interface BenchmarkAppManifest {
  name: string;
  display_name: string;
  status: "implemented" | "planned";
  repo_strategy: string;
  scenario_routes: Record<string, string>;
  browser_lane?: string;
  server_lane?: string;
  notes?: string[];
}

interface BrowserResultFile {
  generated_at: string;
  framework: string;
  runtime: string;
  project: string;
  request_mode?: "cold" | "warm";
  results: Array<{
    scenario: string;
    runtime: string;
    project: string;
    request_mode?: "cold" | "warm";
    url: string;
    status: number | null;
    metrics: Record<string, number | string | null>;
  }>;
}

interface ServerResultFile {
  generated_at: string;
  framework: string;
  runtime: string;
  project: string;
  request_mode?: "cold" | "warm";
  metrics_before?: unknown;
  metrics_after?: unknown;
  results: Array<{
    scenario: string;
    runtime: string;
    project: string;
    request_mode?: "cold" | "warm";
    url: string;
    metrics: Record<string, number | string | null>;
  }>;
}

type FrameworkSummary = {
  manifest: BenchmarkAppManifest | null;
  browser: Record<"cold" | "warm", BrowserResultFile | null>;
  server: Record<"cold" | "warm", ServerResultFile | null>;
};

const DEFAULT_RUNTIME = getStringFlag("runtime") ?? "production-host";
const DEFAULT_PROJECT = getStringFlag("project") ?? "blank";
const DEFAULT_FRAMEWORKS = getStringFlag("frameworks")
  ?.split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const RUN_ID = new Date().toISOString().replace(/[:.]/g, "-");

function formatDelta(
  current: number | null | undefined,
  baseline: number | null | undefined,
): string {
  if (current == null || baseline == null) return "—";
  const absolute = current - baseline;
  if (baseline === 0) return `${absolute.toFixed(2)} (baseline 0)`;
  const percent = (absolute / baseline) * 100;
  return `${absolute.toFixed(2)} (${percent >= 0 ? "+" : ""}${percent.toFixed(1)}%)`;
}

async function loadManifest(framework: string): Promise<BenchmarkAppManifest | null> {
  const manifestPath = join(BENCHMARKS_ROOT, "apps", framework, "manifest.json");
  try {
    return JSON.parse(await Deno.readTextFile(manifestPath)) as BenchmarkAppManifest;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return null;
    throw error;
  }
}

async function loadLatestResult<T extends { framework: string; runtime: string; project: string }>(
  kind: "browser" | "server",
  framework: string,
  runtime: string,
  project: string,
  requestMode: "cold" | "warm",
): Promise<T | null> {
  const files = await listJsonArtifacts(getResultsDir(kind));

  for (const filePath of [...files].reverse()) {
    const parsed = JSON.parse(await Deno.readTextFile(filePath)) as T & { request_mode?: string };
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

function buildMarkdownSummary(
  frameworks: string[],
  runtime: string,
  project: string,
  summary: Record<string, FrameworkSummary>,
): string {
  const lines = [
    "# Local Benchmark Comparison",
    "",
    `- Generated: ${new Date().toISOString()}`,
    `- Runtime: ${runtime}`,
    `- Project: ${project}`,
    `- Frameworks: ${frameworks.join(", ")}`,
    "",
    "## Framework readiness",
    "",
    "| Framework | Status | Browser lane | Server lane | Notes |",
    "| --- | --- | --- | --- | --- |",
  ];
  const requestModes: Array<"cold" | "warm"> = ["cold", "warm"];

  for (const framework of frameworks) {
    const item = summary[framework];
    const manifest = item?.manifest;
    lines.push(
      `| ${framework} | ${manifest?.status ?? "missing"} | ${manifest?.browser_lane ?? "—"} | ${
        manifest?.server_lane ?? "—"
      } | ${(manifest?.notes ?? ["No manifest yet"]).join("; ")} |`,
    );
  }

  lines.push("", "## Browser metrics", "");

  for (const mode of requestModes) {
    lines.push(`### ${mode} browser results`, "");
    for (const framework of frameworks) {
      const browser = summary[framework]?.browser[mode];
      lines.push(`#### ${framework}`);
      if (!browser) {
        lines.push("", `_No ${mode} browser result artifact found for this runtime/project._`, "");
        continue;
      }

      lines.push(
        "",
        "| Scenario | Status | TTFB ms | LCP ms | INP ms | CLS | TBT ms |",
        "| --- | --- | --- | --- | --- | --- | --- |",
      );
      for (const row of browser.results) {
        lines.push(
          `| ${row.scenario} | ${row.status ?? "—"} | ${row.metrics.ttfb_ms ?? "—"} | ${
            row.metrics.lcp_ms ?? "—"
          } | ${row.metrics.inp_ms ?? "—"} | ${row.metrics.cls ?? "—"} | ${
            row.metrics.tbt_ms ?? "—"
          } |`,
        );
      }
      lines.push("");
    }
  }

  lines.push("## Server metrics", "");

  for (const mode of requestModes) {
    lines.push(`### ${mode} server results`, "");
    for (const framework of frameworks) {
      const server = summary[framework]?.server[mode];
      lines.push(`#### ${framework}`);
      if (!server) {
        lines.push("", `_No ${mode} server result artifact found for this runtime/project._`, "");
        continue;
      }

      lines.push(
        "",
        "| Scenario | p50 ms | p95 ms | p99 ms | RPS | Error rate | Bytes |",
        "| --- | --- | --- | --- | --- | --- | --- |",
      );
      for (const row of server.results) {
        lines.push(
          `| ${row.scenario} | ${row.metrics.latency_p50_ms ?? "—"} | ${
            row.metrics.latency_p95_ms ?? "—"
          } | ${row.metrics.latency_p99_ms ?? "—"} | ${row.metrics.requests_per_second ?? "—"} | ${
            row.metrics.error_rate ?? "—"
          } | ${row.metrics.response_bytes ?? "—"} |`,
        );
      }
      lines.push("");
    }
  }

  lines.push("## Gaps", "");

  const gaps: string[] = [];
  for (const framework of frameworks) {
    const item = summary[framework] ?? {
      manifest: null,
      browser: { cold: null, warm: null },
      server: { cold: null, warm: null },
    };
    if (!item.manifest) gaps.push(`- ${framework}: no app manifest scaffold yet`);
    if (!item.browser.cold) {
      gaps.push(`- ${framework}: no cold browser benchmark results for ${runtime}/${project}`);
    }
    if (!item.browser.warm) {
      gaps.push(`- ${framework}: no warm browser benchmark results for ${runtime}/${project}`);
    }
    if (!item.server.cold) {
      gaps.push(`- ${framework}: no cold server benchmark results for ${runtime}/${project}`);
    }
    if (!item.server.warm) {
      gaps.push(`- ${framework}: no warm server benchmark results for ${runtime}/${project}`);
    }
  }

  if (gaps.length === 0) lines.push("- none");
  else lines.push(...gaps);

  const veryfront = summary.veryfront;
  const nextjs = summary.nextjs;
  lines.push("", "## Veryfront vs Next.js deltas", "");
  for (const mode of requestModes) {
    if (veryfront?.browser[mode] && nextjs?.browser[mode]) {
      lines.push(`### ${mode} browser deltas (Veryfront - Next.js)`, "");
      lines.push(
        "| Scenario | Δ TTFB ms | Δ LCP ms | Δ INP ms | Δ CLS | Δ TBT ms |",
        "| --- | --- | --- | --- | --- | --- |",
      );

      for (const vfRow of veryfront.browser[mode]!.results) {
        const nextRow = nextjs.browser[mode]!.results.find((candidate) =>
          candidate.scenario === vfRow.scenario
        );
        if (!nextRow) continue;
        lines.push(
          `| ${vfRow.scenario} | ${
            formatDelta(
              vfRow.metrics.ttfb_ms as number | null | undefined,
              nextRow.metrics.ttfb_ms as number | null | undefined,
            )
          } | ${
            formatDelta(
              vfRow.metrics.lcp_ms as number | null | undefined,
              nextRow.metrics.lcp_ms as number | null | undefined,
            )
          } | ${
            formatDelta(
              vfRow.metrics.inp_ms as number | null | undefined,
              nextRow.metrics.inp_ms as number | null | undefined,
            )
          } | ${
            formatDelta(
              vfRow.metrics.cls as number | null | undefined,
              nextRow.metrics.cls as number | null | undefined,
            )
          } | ${
            formatDelta(
              vfRow.metrics.tbt_ms as number | null | undefined,
              nextRow.metrics.tbt_ms as number | null | undefined,
            )
          } |`,
        );
      }
      lines.push("");
    }

    if (veryfront?.server[mode] && nextjs?.server[mode]) {
      lines.push(`### ${mode} server deltas (Veryfront - Next.js)`, "");
      lines.push(
        "| Scenario | Δ p50 ms | Δ p95 ms | Δ p99 ms | Δ RPS | Δ Error rate |",
        "| --- | --- | --- | --- | --- | --- |",
      );

      for (const vfRow of veryfront.server[mode]!.results) {
        const nextRow = nextjs.server[mode]!.results.find((candidate) =>
          candidate.scenario === vfRow.scenario
        );
        if (!nextRow) continue;
        lines.push(
          `| ${vfRow.scenario} | ${
            formatDelta(
              vfRow.metrics.latency_p50_ms as number | null | undefined,
              nextRow.metrics.latency_p50_ms as number | null | undefined,
            )
          } | ${
            formatDelta(
              vfRow.metrics.latency_p95_ms as number | null | undefined,
              nextRow.metrics.latency_p95_ms as number | null | undefined,
            )
          } | ${
            formatDelta(
              vfRow.metrics.latency_p99_ms as number | null | undefined,
              nextRow.metrics.latency_p99_ms as number | null | undefined,
            )
          } | ${
            formatDelta(
              vfRow.metrics.requests_per_second as number | null | undefined,
              nextRow.metrics.requests_per_second as number | null | undefined,
            )
          } | ${
            formatDelta(
              vfRow.metrics.error_rate as number | null | undefined,
              nextRow.metrics.error_rate as number | null | undefined,
            )
          } |`,
        );
      }
      lines.push("");
    }
  }

  return `${lines.join("\n")}\n`;
}

async function main() {
  const contract = await loadBenchmarkContract();
  const frameworks = DEFAULT_FRAMEWORKS?.length
    ? DEFAULT_FRAMEWORKS
    : contract.comparison_frameworks;
  const summary: Record<string, FrameworkSummary> = {};

  for (const framework of frameworks) {
    const manifest = await loadManifest(framework);
    const browserCold = await loadLatestResult<BrowserResultFile>(
      "browser",
      framework,
      DEFAULT_RUNTIME,
      DEFAULT_PROJECT,
      "cold",
    );
    const browserWarm = await loadLatestResult<BrowserResultFile>(
      "browser",
      framework,
      DEFAULT_RUNTIME,
      DEFAULT_PROJECT,
      "warm",
    );
    const serverCold = await loadLatestResult<ServerResultFile>(
      "server",
      framework,
      DEFAULT_RUNTIME,
      DEFAULT_PROJECT,
      "cold",
    );
    const serverWarm = await loadLatestResult<ServerResultFile>(
      "server",
      framework,
      DEFAULT_RUNTIME,
      DEFAULT_PROJECT,
      "warm",
    );

    summary[framework] = {
      manifest,
      browser: { cold: browserCold, warm: browserWarm },
      server: { cold: serverCold, warm: serverWarm },
    };
  }

  const jsonSummary = {
    generated_at: new Date().toISOString(),
    runtime: DEFAULT_RUNTIME,
    project: DEFAULT_PROJECT,
    frameworks,
    report_dir: getReportDir(),
    summary,
  };

  const baseName = `compare-local-${DEFAULT_RUNTIME}-${DEFAULT_PROJECT}-${RUN_ID}`;
  const jsonPath = await writeReportArtifact(
    baseName,
    JSON.stringify(jsonSummary, null, 2),
    ".json",
  );
  const mdPath = await writeReportArtifact(
    baseName,
    buildMarkdownSummary(frameworks, DEFAULT_RUNTIME, DEFAULT_PROJECT, summary),
    ".md",
  );

  console.log(`Wrote local comparison JSON to ${jsonPath}`);
  console.log(`Wrote local comparison Markdown to ${mdPath}`);
}

if (import.meta.main) {
  await main();
}

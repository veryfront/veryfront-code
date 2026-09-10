import { cpus } from "node:os";
import { PROVIDER_EGRESS_DENY_NET } from "../test/suites.ts";
import { scenarios as scenarioNames } from "./scenarios.ts";
import {
  compare,
  type CpuProfile,
  escapeHtml,
  flamegraph,
  summarizeProfile,
  summarizeRuns,
} from "./report.ts";

type Measurement = {
  operations: number;
  elapsedMs: number;
  msPerOperation: number;
  cpuUsPerOperation: number;
  firstOperationMs: number;
  rssBytes: number;
  checksum: number;
};
type ScenarioResult = {
  name: string;
  runs: Measurement[];
  latencyMs: ReturnType<typeof summarizeRuns>;
  cpuUs: ReturnType<typeof summarizeRuns>;
  comparison?: ReturnType<typeof compare>;
  profile?: Omit<ReturnType<typeof summarizeProfile>, "totals">;
};
type Results = {
  schemaVersion: 1;
  revision: string;
  dirty: boolean;
  sourceDiffSha256: string;
  workloadSha256: string;
  environment: {
    deno: string;
    v8: string;
    os: string;
    arch: string;
    cpu: string;
  };
  settings: { trials: number; durationMs: number; warmupMs: number };
  scenarios: ScenarioResult[];
};

class UsageError extends Error {}
export function options(args: string[]) {
  const result = {
    label: "latest",
    scenario: "all",
    trials: 5,
    durationMs: 1000,
    profile: true,
    baseline: "",
    json: false,
  };
  for (const arg of args) {
    const [key, ...rest] = arg.split("=");
    const value = rest.join("=");
    if (arg === "--json") result.json = true;
    else if (arg === "--no-profile") result.profile = false;
    else if (key === "--label") result.label = value;
    else if (key === "--scenario") result.scenario = value;
    else if (key === "--trials") result.trials = Number(value);
    else if (key === "--duration-ms") result.durationMs = Number(value);
    else if (key === "--baseline") result.baseline = value;
    else throw new UsageError("Unknown option. Use deno task perf --help");
  }
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(result.label)) {
    throw new UsageError(
      "Use a lowercase label with letters, digits, or hyphens",
    );
  }
  if (!["all", ...scenarioNames].includes(result.scenario)) {
    throw new UsageError(`Select all or one of: ${scenarioNames.join(", ")}`);
  }
  if (
    !Number.isInteger(result.trials) || result.trials < 3 || result.trials > 30
  ) throw new UsageError("Trials must be an integer from 3 to 30");
  if (
    !Number.isInteger(result.durationMs) || result.durationMs < 250 ||
    result.durationMs > 30000
  ) {
    throw new UsageError(
      "Duration must be an integer from 250 to 30000 milliseconds",
    );
  }
  return result;
}

const decoder = new TextDecoder();
async function git(args: string[]) {
  return await new Deno.Command("git", {
    args,
    stdout: "piped",
    stderr: "null",
  }).output();
}
async function digest(text: string) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(
    new Uint8Array(bytes),
    (n) => n.toString(16).padStart(2, "0"),
  ).join("");
}
export async function workloadHash(
  readSource: (path: string) => Promise<string> = Deno.readTextFile,
) {
  const source = await Promise.all(
    [
      "run.ts",
      "report.ts",
      "worker.ts",
      "workloads.ts",
      "scenarios.ts",
      "http-worker.ts",
      "http-client.ts",
      "protocol.ts",
    ].map((name) => readSource(`scripts/perf/${name}`)),
  );
  return await digest(source.join("\n"));
}
function table(results: Results): string {
  return [
    "| Workload | Median us/op | Min-max us/op | CPU us/op | Change |",
    "| --- | ---: | ---: | ---: | ---: |",
    ...results.scenarios.map((s) =>
      `| ${s.name} | ${(s.latencyMs.median * 1000).toFixed(2)} | ${
        (s.latencyMs.min * 1000).toFixed(2)
      }-${(s.latencyMs.max * 1000).toFixed(2)} | ${
        s.cpuUs.median.toFixed(2)
      } | ${
        s.comparison ? `${s.comparison.changePercent.toFixed(1)}%` : "baseline"
      } |`
    ),
  ].join("\n");
}

async function main() {
  const started = performance.now();
  if (Deno.args.includes("--help")) {
    console.log(
      "Profile synthetic framework workloads on the pinned Deno version.\n\n" +
        `deno task perf [--scenario=all|${
          scenarioNames.join("|")
        }] [--label=latest]\n` +
        "  [--trials=5] [--duration-ms=1000] [--baseline=.cache/perf/before/results.json]\n" +
        "  [--no-profile] [--json]\n\n" +
        "Outputs: .cache/perf/<label>/{index.html,summary.md,results.json,*.cpuprofile}\n" +
        "Measurements run without the profiler. Negative change means lower latency.",
    );
    return;
  }
  const opts = options(Deno.args);
  const pin = (await Deno.readTextFile(".tool-versions")).match(
    /^deno\s+(\S+)/m,
  )?.[1];
  if (Deno.version.deno !== pin) {
    throw new UsageError(
      "Activate the Deno version in .tool-versions before profiling",
    );
  }
  const output = `.cache/perf/${opts.label}`;
  const workloadSha256 = await workloadHash();
  const [revision, status, diff] = await Promise.all([
    git(["rev-parse", "HEAD"]),
    git(["status", "--porcelain"]),
    git(["diff", "HEAD", "--", "src", "extensions"]),
  ]);
  if (!revision.success) {
    throw new Error("Run this command from a Git checkout");
  }
  const results: Results = {
    schemaVersion: 1,
    revision: decoder.decode(revision.stdout).trim(),
    dirty: status.stdout.length > 0,
    sourceDiffSha256: await digest(decoder.decode(diff.stdout)),
    workloadSha256,
    environment: {
      deno: Deno.version.deno,
      v8: Deno.version.v8,
      os: Deno.build.os,
      arch: Deno.build.arch,
      cpu: cpus()[0]?.model ?? "unknown",
    },
    settings: {
      trials: opts.trials,
      durationMs: opts.durationMs,
      warmupMs: 500,
    },
    scenarios: [],
  };
  let baseline: Results | undefined;
  if (opts.baseline) {
    try {
      baseline = JSON.parse(await Deno.readTextFile(opts.baseline));
    } catch {
      throw new UsageError(
        "Read a valid baseline results.json before comparing",
      );
    }
    if (
      baseline?.schemaVersion !== 1 ||
      baseline.workloadSha256 !== results.workloadSha256 ||
      JSON.stringify(baseline.environment) !==
        JSON.stringify(results.environment) ||
      JSON.stringify(baseline.settings) !== JSON.stringify(results.settings)
    ) {
      throw new UsageError(
        "Baseline must use the same workload, runtime, hardware, and measurement settings",
      );
    }
  }
  // Read and validate the baseline before replacing a reused output label.
  await Deno.remove(output, { recursive: true }).catch((error) => {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  });
  await Deno.mkdir(output, { recursive: true });
  // Clear credentials and ambient framework flags. HTTP bootstrap may fetch CDN
  // dependencies; inference provider origins remain denied.
  const env: Record<string, string> = {
    NODE_ENV: "production",
    LOG_LEVEL: "error",
    LOG_FORMAT: "text",
    VF_DISABLE_LRU_INTERVAL: "1",
  };
  for (
    const key of [
      "PATH",
      "HOME",
      "USERPROFILE",
      "SYSTEMROOT",
      "TMPDIR",
      "TEMP",
      "DENO_DIR",
      "XDG_CACHE_HOME",
    ]
  ) {
    const value = Deno.env.get(key);
    if (value) env[key] = value;
  }
  const graphs: string[] = [];
  for (
    const name of scenarioNames.filter((name) =>
      opts.scenario === "all" || opts.scenario === name
    )
  ) {
    const runs: Measurement[] = [];
    const profilePath = `${output}/${name}.cpuprofile`;
    for (let trial = 0; trial < opts.trials; trial++) {
      if (!opts.json) {
        console.error(`${name}: trial ${trial + 1}/${opts.trials}`);
      }
      // Match the task's named run permission, including symlinked toolchains.
      const command = new Deno.Command("deno", {
        args: [
          "run",
          "--frozen",
          "--no-prompt",
          "--allow-read",
          "--allow-write=.cache",
          "--allow-env",
          "--allow-sys",
          ...(name.startsWith("http-")
            ? [
              "--allow-net",
              PROVIDER_EGRESS_DENY_NET,
              "--allow-run",
              "--unstable-worker-options",
            ]
            : ["--deny-net"]),
          name.startsWith("http-")
            ? "scripts/perf/http-worker.ts"
            : "scripts/perf/worker.ts",
          name,
          String(opts.durationMs),
          ...(opts.profile && trial === 0 ? [profilePath] : []),
        ],
        env,
        clearEnv: true,
        stdout: "piped",
        stderr: "piped",
      });
      const child = command.spawn();
      const timeout = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch { /* Already exited. */ }
      }, 120000);
      let result;
      try {
        result = await child.output();
      } finally {
        clearTimeout(timeout);
      }
      if (!result.success) {
        throw new Error(
          `The ${name} workload failed. Run the focused SSR or observability tests to diagnose setup`,
        );
      }
      try {
        runs.push(JSON.parse(decoder.decode(result.stdout)));
      } catch {
        throw new Error(`The ${name} workload did not return a measurement`);
      }
    }
    const scenario: ScenarioResult = {
      name,
      runs,
      latencyMs: summarizeRuns(runs.map((r) => r.msPerOperation)),
      cpuUs: summarizeRuns(runs.map((r) => r.cpuUsPerOperation)),
    };
    if (baseline) {
      const previous = baseline.scenarios.find((s) => s.name === name);
      if (!previous) {
        throw new UsageError("Baseline must include every selected workload");
      }
      scenario.comparison = compare(
        previous.latencyMs.median,
        scenario.latencyMs.median,
      );
    }
    if (opts.profile) {
      const profile: CpuProfile = JSON.parse(
        await Deno.readTextFile(profilePath),
      );
      const { totals: _, ...summary } = summarizeProfile(profile);
      scenario.profile = summary;
      graphs.push(
        `<h2>${name}</h2><p><a href="${name}.cpuprofile">Download CPU profile</a>. Width shows sampled time, including runtime and idle samples. Select a frame to zoom; select Reset to restore.</p><button class="reset">Reset</button>${
          flamegraph(profile)
        }`,
      );
    }
    results.scenarios.push(scenario);
  }
  const summary = `# Framework performance\n\nRevision: ${results.revision}${
    results.dirty ? " (working tree changes)" : ""
  }. Deno ${Deno.version.deno}.\n\n${
    table(results)
  }\n\nEach value summarizes ${opts.trials} fresh processes after 500 ms warmup. Min-max is the spread of per-process averages, not request percentiles. CPU profiles are captured separately from measurements.\n\nSynthetic workloads cover request instrumentation, buffered SSR, and full loopback HTTP requests. HTTP profiles and CPU time cover the server process; a separate client consumes and validates each response. http-api returns 100 JSON items, http-cached serves cached HTML, http-ssr renders uncached production HTML, and http-dev renders uncached development HTML. HTTP runs include bootstrap and first-request timing separately in JSON. They do not measure deployed infrastructure, browser hydration, external services, or worker execution. Lower latency is better; small changes within the run spread are inconclusive.\n`;
  const hotspots = results.scenarios.filter((s) => s.profile).map((s) =>
    `\n## ${s.name}: sampled hotspots\n\n| Function | Self ms | Location |\n| --- | ---: | --- |\n${
      s.profile!.hotspots.slice(0, 10).map((h) =>
        `| ${h.name.replace(/[|\r\n]/g, " ")} | ${h.selfMs.toFixed(2)} | ${
          h.location.replace(/[|\r\n]/g, " ")
        } |`
      ).join("\n")
    }\n`
  ).join("");
  await Deno.writeTextFile(
    `${output}/results.json`,
    JSON.stringify(results, null, 2) + "\n",
  );
  await Deno.writeTextFile(`${output}/summary.md`, summary + hotspots);
  const html =
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Veryfront performance</title><style>body{font:16px system-ui;margin:32px auto;max-width:1400px;padding:0 20px;color:#202938}pre{white-space:pre-wrap;background:#f4f6f8;padding:20px;overflow:auto}svg{width:100%;height:600px;border:1px solid #ddd;margin:12px 0}g[role=button]{cursor:pointer}button{padding:6px 16px}a{color:#205bc0}</style><h1>Veryfront performance</h1><p><a href="results.json">JSON for coding agents</a> | <a href="summary.md">Markdown report</a></p><pre>${
      escapeHtml(summary)
    }</pre>${graphs.join("")}<h2>Hotspots</h2><pre>${
      escapeHtml(hotspots)
    }</pre><script>for(const svg of document.querySelectorAll('svg')){const original=svg.getAttribute('viewBox');const zoom=g=>{const [x,y,w]=g.dataset.box.split(' ').map(Number);svg.setAttribute('viewBox',x+' '+y+' '+w+' '+Math.max(22,Math.min(Number(svg.dataset.height)-y,w/2))); };svg.addEventListener('click',e=>{const g=e.target.closest('g');if(g)zoom(g)});svg.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.matches('g'))zoom(e.target)});svg.previousElementSibling.addEventListener('click',()=>svg.setAttribute('viewBox',original));}</script></html>`;
  await Deno.writeTextFile(`${output}/index.html`, html);
  if (opts.json) {
    console.log(
      JSON.stringify({
        success: true,
        command: "perf",
        data: { directory: output, results },
        timing: { duration_ms: performance.now() - started },
      }),
    );
  } else {console.log(
      `${
        table(results)
      }\n\nReport: ${output}/index.html\nAgent data: ${output}/results.json`,
    );}
}

if (import.meta.main) {
  const started = performance.now();
  try {
    await main();
  } catch (error) {
    const message = error instanceof UsageError
      ? error.message
      : error instanceof Error && !/[/\\]/.test(error.message)
      ? error.message
      : "Performance capture failed. Ensure dependencies are cached and the output directory is writable";
    if (Deno.args.includes("--json")) {
      console.log(JSON.stringify({
        success: false,
        command: "perf",
        error: {
          code: error instanceof UsageError ? "USAGE_ERROR" : "RUNTIME_ERROR",
          slug: error instanceof UsageError
            ? "invalid-arguments"
            : "command-failed",
          message,
        },
        timing: { duration_ms: performance.now() - started },
      }));
    } else console.error(message);
    Deno.exitCode = error instanceof UsageError ? 2 : 1;
  }
}

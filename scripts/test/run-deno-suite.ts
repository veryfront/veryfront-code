import { parseArgs } from "#std/flags";
import { planSuiteFiles, type SuitePlanId } from "./run-suite.ts";
import {
  buildTestProcessEnv,
  DENO_TEST_ENV,
  PROVIDER_EGRESS_DENY_NET,
} from "./suites.ts";

type DenoSuitePlanId = Exclude<
  SuitePlanId,
  "runtime:node" | "runtime:bun"
>;

/**
 * How one Deno suite executes. Every flag decision is an explicit field so a
 * new lane cannot silently inherit less isolation than the others: the prior
 * hand-written flag branches had already drifted (integration:cli ran with no
 * preload, no deny-net, and no trace-leaks; the legacy tests root skipped
 * deny-net; coverage skipped trace-leaks) and nothing noticed.
 */
export interface DenoSuiteProfile {
  /** Merged over the parent env after provider credentials are removed. */
  readonly env: Readonly<Record<string, string>>;
  /** Install src/testing/preload.ts (test isolation + unpinned transport). */
  readonly preload: boolean;
  /** Deny egress to live inference providers. */
  readonly denyNet: boolean;
  /** Required when denyNet is false: why this lane may reach live services. */
  readonly denyNetOptOutReason?: string;
  /** Leaks are load-dependent; the first failure must carry the stack. */
  readonly traceLeaks: boolean;
  readonly parallel: boolean;
  /** Raise the V8 old-space ceiling for memory-heavy lanes. */
  readonly heap: boolean;
  /** Collect coverage into --coverage-dir (default "coverage"). */
  readonly coverage: boolean;
  /** Genuinely suite-specific flags, rendered before the file list. */
  readonly extraFlags: readonly string[];
}

const UNIT_PROFILE: DenoSuiteProfile = {
  env: DENO_TEST_ENV,
  preload: true,
  denyNet: true,
  traceLeaks: true,
  parallel: true,
  heap: true,
  coverage: false,
  extraFlags: [],
};

export const DENO_SUITE_PROFILES: Readonly<
  Record<DenoSuitePlanId, DenoSuiteProfile>
> = Object.freeze({
  "unit:parallel": UNIT_PROFILE,
  // Working-directory assertions cannot share a process with parallel peers.
  "unit:cwd": { ...UNIT_PROFILE, parallel: false },
  "unit:cwd-exclusion": UNIT_PROFILE,
  "integration:legacy-tests-root": {
    env: DENO_TEST_ENV,
    preload: true,
    denyNet: true,
    traceLeaks: true,
    parallel: true,
    heap: false,
    coverage: false,
    // Belt and braces: the planner already excludes these, and the ignore
    // keeps a stray positional path from pulling them back in.
    extraFlags: [
      "--ignore=tests/e2e,tests/integration/compiled-binary-e2e.test.ts",
    ],
  },
  "integration:cli": {
    env: DENO_TEST_ENV,
    preload: true,
    denyNet: true,
    traceLeaks: true,
    parallel: true,
    heap: false,
    coverage: false,
    extraFlags: [],
  },
  "coverage:unit": {
    ...UNIT_PROFILE,
    coverage: true,
    extraFlags: ["--fail-fast", "--ignore=tests,src/workflow/__tests__"],
  },
  "coverage:integration": {
    env: DENO_TEST_ENV,
    preload: true,
    denyNet: true,
    traceLeaks: true,
    parallel: true,
    heap: true,
    coverage: true,
    extraFlags: ["--fail-fast"],
  },
  // Spawns real servers and a Chromium page per test; not parallel and not
  // memory-bound, but the harness itself is a framework test process.
  "e2e:rsc-browser": {
    env: DENO_TEST_ENV,
    preload: true,
    denyNet: true,
    traceLeaks: true,
    parallel: false,
    heap: false,
    coverage: false,
    extraFlags: [],
  },
  // The compiled binary under test inherits this process env, and the lane
  // has always exercised it with a clean production-like environment, so the
  // shared test prefix stays off. VERYFRONT_BINARY* passthrough still works
  // because the spawned `deno test` inherits the parent env. The preload and
  // deny-net apply to the harness process only, never to the binary.
  "e2e:binary": {
    env: {},
    preload: true,
    denyNet: true,
    traceLeaks: true,
    parallel: false,
    heap: false,
    coverage: false,
    extraFlags: [],
  },
});

interface DenoSuiteCommandOptions {
  readonly coverageDir?: string;
  readonly passthroughArgs?: readonly string[];
}

interface ParsedDenoSuiteArgs extends DenoSuiteCommandOptions {
  readonly suite?: string;
  readonly passthroughArgs: readonly string[];
}

export function parseDenoSuiteArgs(
  args: readonly string[],
): ParsedDenoSuiteArgs {
  const adapterArgs: string[] = [];
  const passthroughArgs: string[] = [];

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--suite" || arg === "--coverage-dir") {
      adapterArgs.push(arg);
      if (index + 1 < args.length) adapterArgs.push(args[++index]);
    } else if (
      arg.startsWith("--suite=") || arg.startsWith("--coverage-dir=")
    ) {
      adapterArgs.push(arg);
    } else {
      passthroughArgs.push(arg);
    }
  }

  const flags = parseArgs(adapterArgs, {
    string: ["suite", "coverage-dir"],
  });
  return {
    ...(flags.suite ? { suite: flags.suite } : {}),
    ...(flags["coverage-dir"] ? { coverageDir: flags["coverage-dir"] } : {}),
    passthroughArgs,
  };
}

export function buildDenoSuiteCommandArgs(
  suite: DenoSuitePlanId,
  files: readonly string[],
  options: DenoSuiteCommandOptions = {},
): string[] {
  const profile = DENO_SUITE_PROFILES[suite];
  const passthroughArgs = options.passthroughArgs ?? [];
  return [
    "test",
    ...(profile.preload ? ["--preload=src/testing/preload.ts"] : []),
    "--no-check",
    ...(profile.traceLeaks ? ["--trace-leaks"] : []),
    ...(profile.parallel ? ["--parallel"] : []),
    "--allow-all",
    ...(profile.denyNet ? [PROVIDER_EGRESS_DENY_NET] : []),
    ...(profile.heap ? ["--v8-flags=--max-old-space-size=8192"] : []),
    ...(profile.coverage
      ? [`--coverage=${options.coverageDir ?? "coverage"}`]
      : []),
    ...profile.extraFlags,
    "--unstable-worker-options",
    "--unstable-net",
    ...passthroughArgs,
    ...files,
  ];
}

if (import.meta.main) {
  const flags = parseDenoSuiteArgs(Deno.args);
  if (!flags.suite || !(flags.suite in DENO_SUITE_PROFILES)) {
    console.error("Usage: run-deno-suite.ts --suite=<Deno suite profile>");
    Deno.exit(2);
  }

  const suite = flags.suite as DenoSuitePlanId;
  const plan = await planSuiteFiles({ suite });
  const status = await new Deno.Command("deno", {
    args: buildDenoSuiteCommandArgs(suite, plan.files, {
      ...(flags.coverageDir ? { coverageDir: flags.coverageDir } : {}),
      passthroughArgs: flags.passthroughArgs,
    }),
    clearEnv: true,
    env: buildTestProcessEnv(
      Deno.env.toObject(),
      DENO_SUITE_PROFILES[suite].env,
    ),
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }).spawn().status;
  Deno.exit(status.code);
}

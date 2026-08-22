import { parseArgs } from "#std/flags";
import { planSuiteFiles, type SuitePlanId } from "./run-suite.ts";

type DenoSuitePlanId = Exclude<
  SuitePlanId,
  "runtime:node" | "runtime:bun"
>;

const DENO_SUITES = new Set<DenoSuitePlanId>([
  "unit:parallel",
  "unit:cwd",
  "unit:cwd-exclusion",
  "integration:legacy-tests-root",
  "integration:cli",
  "coverage:unit",
]);

const PROVIDER_EGRESS_DENY_NET =
  "--deny-net=api.openai.com,api.anthropic.com,generativelanguage.googleapis.com,api.mistral.ai,api.groq.com,api.deepseek.com,openrouter.ai";

export function buildDenoSuiteCommandArgs(
  suite: DenoSuitePlanId,
  files: readonly string[],
  options: { readonly coverageDir?: string } = {},
): string[] {
  if (suite === "coverage:unit") {
    return [
      "test",
      "--preload=src/testing/preload.ts",
      "--no-check",
      "--parallel",
      "--fail-fast",
      "--allow-all",
      PROVIDER_EGRESS_DENY_NET,
      "--v8-flags=--max-old-space-size=8192",
      `--coverage=${options.coverageDir ?? "coverage"}`,
      "--ignore=tests,src/workflow/__tests__",
      "--unstable-worker-options",
      "--unstable-net",
      ...files,
    ];
  }

  if (suite === "integration:cli") {
    return [
      "test",
      "--no-check",
      "--parallel",
      "--allow-all",
      "--unstable-worker-options",
      "--unstable-net",
      ...files,
    ];
  }

  if (suite === "integration:legacy-tests-root") {
    return [
      "test",
      "--preload=src/testing/preload.ts",
      "--no-check",
      "--parallel",
      "--allow-all",
      "--ignore=tests/e2e,tests/integration/compiled-binary-e2e.test.ts",
      "--unstable-worker-options",
      "--unstable-net",
      ...files,
    ];
  }

  return [
    "test",
    "--preload=src/testing/preload.ts",
    "--no-check",
    "--trace-leaks",
    ...(suite === "unit:cwd" ? [] : ["--parallel"]),
    "--allow-all",
    PROVIDER_EGRESS_DENY_NET,
    "--v8-flags=--max-old-space-size=8192",
    "--unstable-worker-options",
    "--unstable-net",
    ...files,
  ];
}

if (import.meta.main) {
  const flags = parseArgs(Deno.args, {
    string: ["suite", "coverage-dir"],
  });
  if (!flags.suite || !DENO_SUITES.has(flags.suite as DenoSuitePlanId)) {
    console.error("Usage: run-deno-suite.ts --suite=<Deno suite profile>");
    Deno.exit(2);
  }

  const suite = flags.suite as DenoSuitePlanId;
  const plan = await planSuiteFiles({ suite });
  const status = await new Deno.Command("deno", {
    args: buildDenoSuiteCommandArgs(suite, plan.files, {
      ...(flags["coverage-dir"] ? { coverageDir: flags["coverage-dir"] } : {}),
    }),
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }).spawn().status;
  Deno.exit(status.code);
}

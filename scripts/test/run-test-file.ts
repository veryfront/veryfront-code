import {
  buildTestProcessEnv,
  DENO_TEST_ENV,
  LOOPBACK_TEST_PERMISSIONS,
  PROVIDER_EGRESS_DENY_NET,
  UNIT_DENO_TEST_ENV,
} from "./suites.ts";

export {
  LOOPBACK_ALLOW_NET,
  PROVIDER_EGRESS_DENY_NET,
  UNIT_DENO_TEST_ENV as TEST_FILE_ENV,
} from "./suites.ts";

const TEST_OPTIONS_WITH_SEPARATE_VALUE = new Set([
  "--cert",
  "--config",
  "--env-file",
  "--filter",
  "--import-map",
  "--junit-path",
  "--location",
  "--lock",
  "--reporter",
  "--seed",
  "--v8-flags",
]);
const MAX_TARGET_DIRECTORY_ENTRIES = 10_000;

function getPositionalTestTargets(rawArgs: readonly string[]): string[] {
  const targets: string[] = [];
  let optionsEnded = false;
  for (let index = 0; index < rawArgs.length; index++) {
    const arg = rawArgs[index]!;
    if (!optionsEnded && arg === "--") {
      optionsEnded = true;
      continue;
    }
    if (!optionsEnded && arg.startsWith("-")) {
      const option = arg.split("=", 1)[0]!;
      if (!arg.includes("=") && TEST_OPTIONS_WITH_SEPARATE_VALUE.has(option)) {
        index += 1;
      }
      continue;
    }
    targets.push(arg);
  }
  return targets;
}

export function buildTestFileCommandArgs(rawArgs: string[]): string[] {
  const targets = getPositionalTestTargets(rawArgs);
  const usesScriptsConfig = targets.some(isScriptsPath);
  const usesIntegrationPermissions = targets.some(isIntegrationTarget);
  const configArgs = usesScriptsConfig
    ? ["--config=scripts/test.deno.json"]
    : ["--preload=src/testing/preload.ts"];

  return [
    "test",
    ...configArgs,
    "--no-check",
    // Leaks here are load-dependent and do not reproduce on demand, so the
    // first failure has to carry the stack rather than advise a rerun.
    "--trace-leaks",
    ...(usesIntegrationPermissions
      ? ["--allow-all", PROVIDER_EGRESS_DENY_NET]
      : LOOPBACK_TEST_PERMISSIONS),
    "--unstable-worker-options",
    "--unstable-net",
    ...rawArgs,
  ];
}

function isScriptsPath(arg: string): boolean {
  const normalized = arg.replaceAll("\\", "/").replace(/^\.\//, "");
  return normalized === "scripts" || normalized.startsWith("scripts/");
}

function isIntegrationPath(arg: string): boolean {
  const normalized = arg.replaceAll("\\", "/").replace(/^\.\//, "");
  return normalized === "tests" ||
    normalized.startsWith("tests/") ||
    /\.integration\.test\.tsx?$/.test(normalized);
}

function isIntegrationTarget(arg: string): boolean {
  if (isIntegrationPath(arg)) return true;
  const normalized = arg.replaceAll("\\", "/").replace(/^\.\//, "");
  try {
    if (!Deno.statSync(normalized).isDirectory) return false;
  } catch (error) {
    return !(error instanceof Deno.errors.NotFound);
  }

  const pending = [normalized];
  let visitedEntries = 0;
  while (pending.length > 0) {
    const directory = pending.pop()!;
    try {
      for (const entry of Deno.readDirSync(directory)) {
        visitedEntries += 1;
        if (visitedEntries > MAX_TARGET_DIRECTORY_ENTRIES) return true;
        if (entry.isSymlink) continue;
        const path = `${directory}/${entry.name}`;
        if (entry.isDirectory) {
          pending.push(path);
        } else if (entry.isFile && isIntegrationPath(path)) {
          return true;
        }
      }
    } catch {
      return true;
    }
  }
  return false;
}

async function main(): Promise<void> {
  const environment =
    getPositionalTestTargets(Deno.args).some(isIntegrationTarget)
      ? DENO_TEST_ENV
      : UNIT_DENO_TEST_ENV;
  const command = new Deno.Command("deno", {
    args: buildTestFileCommandArgs(Deno.args),
    clearEnv: true,
    env: buildTestProcessEnv(Deno.env.toObject(), environment),
    stdout: "inherit",
    stderr: "inherit",
  });
  const status = await command.spawn().status;
  if (!status.success) Deno.exit(status.code);
}

if (import.meta.main) {
  await main();
}

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
  "--ignore",
  "--import-map",
  "--junit-path",
  "--location",
  "--lock",
  "--reporter",
  "--seed",
  "--v8-flags",
]);
const MAX_TARGET_DIRECTORY_ENTRIES = 10_000;
const MISSING_TEST_TARGET_MESSAGE =
  "test:file requires at least one test file or directory target";

export interface TestTargetFileSystem {
  statSync(path: string): Pick<Deno.FileInfo, "isDirectory">;
  readDirSync(path: string): Iterable<Deno.DirEntry>;
}

const TEST_TARGET_FILE_SYSTEM: TestTargetFileSystem = {
  statSync: (path) => Deno.statSync(path),
  readDirSync: (path) => Deno.readDirSync(path),
};

function getPositionalTestTargets(rawArgs: readonly string[]): string[] {
  const targets: string[] = [];
  for (let index = 0; index < rawArgs.length; index++) {
    const arg = rawArgs[index]!;
    if (arg === "--") break;
    if (arg.startsWith("-")) {
      const option = arg.split("=", 1)[0]!;
      if (!arg.includes("=") && TEST_OPTIONS_WITH_SEPARATE_VALUE.has(option)) {
        index += 1;
      }
      continue;
    }
    targets.push(arg);
  }
  if (targets.length === 0) {
    throw new TestFileUsageError(MISSING_TEST_TARGET_MESSAGE);
  }
  return targets;
}

class TestFileUsageError extends Error {}

export function buildTestFileCommandArgs(
  rawArgs: string[],
  fileSystem: TestTargetFileSystem = TEST_TARGET_FILE_SYSTEM,
): string[] {
  const targets = getPositionalTestTargets(rawArgs);
  const usesScriptsConfig = targets.some(isScriptsPath);
  const usesIntegrationPermissions = targets.some((target) =>
    isIntegrationTarget(target, fileSystem)
  );
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

function isIntegrationTarget(
  arg: string,
  fileSystem: TestTargetFileSystem = TEST_TARGET_FILE_SYSTEM,
): boolean {
  if (isIntegrationPath(arg)) return true;
  const normalized = arg.replaceAll("\\", "/").replace(/^\.\//, "");
  try {
    if (!fileSystem.statSync(normalized).isDirectory) return false;
  } catch {
    return false;
  }

  const pending = [normalized];
  let visitedEntries = 0;
  while (pending.length > 0) {
    const directory = pending.pop()!;
    try {
      for (const entry of fileSystem.readDirSync(directory)) {
        visitedEntries += 1;
        if (visitedEntries > MAX_TARGET_DIRECTORY_ENTRIES) return false;
        if (entry.isSymlink) continue;
        const path = `${directory}/${entry.name}`;
        if (entry.isDirectory) {
          pending.push(path);
        } else if (entry.isFile && isIntegrationPath(path)) {
          return true;
        }
      }
    } catch {
      return false;
    }
  }
  return false;
}

async function main(): Promise<void> {
  let targets: string[];
  try {
    targets = getPositionalTestTargets(Deno.args);
  } catch (error) {
    if (!(error instanceof TestFileUsageError)) throw error;
    console.error(error.message);
    Deno.exit(2);
  }
  const environment =
    targets.some((target) =>
        isIntegrationTarget(target, TEST_TARGET_FILE_SYSTEM)
      )
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

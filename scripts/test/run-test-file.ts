import {
  buildTestProcessEnv,
  DENO_TEST_ENV,
  hasDenoPermissionFlag,
  LOOPBACK_TEST_PERMISSIONS,
  PROVIDER_EGRESS_DENY_NET,
  UNIT_DENO_TEST_ENV,
} from "./suites.ts";
import { join, relative, resolve } from "node:path";

export {
  LOOPBACK_ALLOW_NET,
  PROVIDER_EGRESS_DENY_NET,
  UNIT_DENO_TEST_ENV as TEST_FILE_ENV,
} from "./suites.ts";

const TEST_OPTIONS_WITH_SEPARATE_VALUE = new Set([
  "-L",
  "-c",
  "--cert",
  "--conditions",
  "--config",
  "--env-file",
  "--ext",
  "--filter",
  "--ignore",
  "--import-map",
  "--junit-path",
  "--location",
  "--lock",
  "--log-level",
  "--minimum-dependency-age",
  "--preload",
  "--reporter",
  "--require",
  "--seed",
  "--v8-flags",
]);
const MAX_TARGET_DIRECTORY_ENTRIES = 10_000;
const MISSING_TEST_TARGET_MESSAGE =
  "test:file requires at least one test file or directory target";
const FORWARDED_PERMISSION_MESSAGE =
  "test:file does not accept forwarded permission flags";

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

function buildTestFileCommandArgsForRawArgs(
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

export function getJunitPath(rawArgs: readonly string[]): string | undefined {
  for (let index = 0; index < rawArgs.length; index++) {
    const arg = rawArgs[index]!;
    if (arg === "--") return undefined;
    if (arg === "--junit-path") return rawArgs[index + 1];
    if (arg.startsWith("--junit-path=")) {
      return arg.slice("--junit-path=".length);
    }
    if (arg.startsWith("-")) {
      const option = arg.split("=", 1)[0]!;
      if (!arg.includes("=") && TEST_OPTIONS_WITH_SEPARATE_VALUE.has(option)) {
        index += 1;
      }
    }
  }
  return undefined;
}

export function hasDenoNoRun(rawArgs: readonly string[]): boolean {
  for (let index = 0; index < rawArgs.length; index++) {
    const arg = rawArgs[index]!;
    if (arg === "--") return false;
    if (arg === "--no-run" || arg.startsWith("--no-run=")) return true;
    if (arg.startsWith("-")) {
      const option = arg.split("=", 1)[0]!;
      if (!arg.includes("=") && TEST_OPTIONS_WITH_SEPARATE_VALUE.has(option)) {
        index += 1;
      }
    }
  }
  return false;
}

function rewriteJunitPath(
  rawArgs: readonly string[],
  junitPath: string,
): string[] {
  const rewritten: string[] = [];
  for (let index = 0; index < rawArgs.length; index++) {
    const arg = rawArgs[index]!;
    if (arg === "--") {
      rewritten.push(...rawArgs.slice(index));
      break;
    }
    if (arg === "--junit-path") {
      rewritten.push(arg, junitPath);
      index += 1;
      continue;
    }
    if (arg.startsWith("--junit-path=")) {
      rewritten.push(`--junit-path=${junitPath}`);
      continue;
    }
    if (arg.startsWith("-")) {
      const option = arg.split("=", 1)[0]!;
      if (!arg.includes("=") && TEST_OPTIONS_WITH_SEPARATE_VALUE.has(option)) {
        rewritten.push(arg);
        if (index + 1 < rawArgs.length) {
          rewritten.push(rawArgs[index + 1]!);
          index += 1;
        }
        continue;
      }
    }
    rewritten.push(arg);
  }
  return rewritten;
}

export interface SplitJunitRewriteResult {
  commandArgGroups: string[][];
  requestedJunitPath?: string;
}

export interface TemporaryJunitPathOptions {
  id?: string;
  tempDirectory?: string;
}

export function buildTemporaryJunitPaths(
  requestedJunitPath: string,
  count: number,
  {
    id = crypto.randomUUID(),
    tempDirectory = Deno.env.get("TMPDIR") ?? ".",
  }: TemporaryJunitPathOptions = {},
): string[] {
  const temporaryPathPrefix = requestedJunitPath === "-"
    ? join(tempDirectory, `veryfront-test-file-junit-${id}`)
    : requestedJunitPath;
  return Array.from(
    { length: count },
    (_, index) => `${temporaryPathPrefix}.part-${index}-${id}.xml`,
  );
}

export function rewriteSplitJunitPathForCommandArgGroups(
  commandArgGroups: readonly string[][],
  temporaryJunitPaths: readonly string[],
): SplitJunitRewriteResult {
  const requestedJunitPath = commandArgGroups.length > 1
    ? getJunitPath(commandArgGroups[0] ?? [])
    : undefined;
  if (!requestedJunitPath) {
    return { commandArgGroups: commandArgGroups.map((group) => [...group]) };
  }
  if (temporaryJunitPaths.length !== commandArgGroups.length) {
    throw new Error(
      "temporary JUnit path count must match test command groups",
    );
  }
  return {
    requestedJunitPath,
    commandArgGroups: commandArgGroups.map((group, index) =>
      rewriteJunitPath(group, temporaryJunitPaths[index]!)
    ),
  };
}

function filterRawArgsByTargetKind(
  rawArgs: string[],
  keepTarget: (target: string) => boolean,
): string[] {
  const filtered: string[] = [];
  for (let index = 0; index < rawArgs.length; index++) {
    const arg = rawArgs[index]!;
    if (arg === "--") {
      filtered.push(...rawArgs.slice(index));
      break;
    }
    if (arg.startsWith("-")) {
      filtered.push(arg);
      const option = arg.split("=", 1)[0]!;
      if (!arg.includes("=") && TEST_OPTIONS_WITH_SEPARATE_VALUE.has(option)) {
        index += 1;
        filtered.push(rawArgs[index]!);
      }
      continue;
    }
    if (keepTarget(arg)) filtered.push(arg);
  }
  return filtered;
}

export function buildTestFileCommandArgGroups(
  rawArgs: string[],
  fileSystem: TestTargetFileSystem = TEST_TARGET_FILE_SYSTEM,
): string[][] {
  const targets = getPositionalTestTargets(rawArgs);
  if (hasDenoPermissionFlag(rawArgs)) {
    throw new TestFileUsageError(FORWARDED_PERMISSION_MESSAGE);
  }
  const hasScriptsTargets = targets.some(isScriptsPath);
  const hasSourceTargets = targets.some((target) => !isScriptsPath(target));
  if (!hasScriptsTargets || !hasSourceTargets) {
    return [buildTestFileCommandArgsForRawArgs(rawArgs, fileSystem)];
  }
  return [
    buildTestFileCommandArgsForRawArgs(
      filterRawArgsByTargetKind(rawArgs, (target) => !isScriptsPath(target)),
      fileSystem,
    ),
    buildTestFileCommandArgsForRawArgs(
      filterRawArgsByTargetKind(rawArgs, isScriptsPath),
      fileSystem,
    ),
  ];
}

export function buildTestFileCommandArgs(
  rawArgs: string[],
  fileSystem: TestTargetFileSystem = TEST_TARGET_FILE_SYSTEM,
): string[] {
  return buildTestFileCommandArgGroups(rawArgs, fileSystem)[0]!;
}

function isScriptsPath(arg: string): boolean {
  const normalized = normalizeTestTarget(arg);
  return normalized === "scripts" || normalized.startsWith("scripts/");
}

function isIntegrationPath(arg: string): boolean {
  const normalized = normalizeTestTarget(arg);
  return normalized === "tests" ||
    normalized.startsWith("tests/") ||
    /\.integration\.test\.tsx?$/.test(normalized);
}

function normalizeTestTarget(arg: string): string {
  const projectRelative = relative(Deno.cwd(), resolve(Deno.cwd(), arg));
  return projectRelative.replaceAll("\\", "/").replace(/^\.\//, "");
}

function isIntegrationTarget(
  arg: string,
  fileSystem: TestTargetFileSystem = TEST_TARGET_FILE_SYSTEM,
): boolean {
  if (isIntegrationPath(arg)) return true;
  const normalized = normalizeTestTarget(arg);
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

function readXmlNumberAttribute(attributes: string, name: string): number {
  const match = new RegExp(`${name}="([^">]*)"`).exec(attributes);
  if (!match?.[1]) return 0;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : 0;
}

function formatXmlNumber(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : String(Number(value.toFixed(6)));
}

export function mergeDenoJunitReports(reports: readonly string[]): string {
  if (reports.length === 0) return "";
  if (reports.length === 1) return reports[0]!;

  const totals = { tests: 0, failures: 0, errors: 0, skipped: 0, time: 0 };
  const bodies: string[] = [];
  for (const report of reports) {
    const withoutDeclaration = report.replace(/^<\?xml[^>]*>\s*/u, "").trim();
    const suites = /^<testsuites\b([^>]*)>([\s\S]*)<\/testsuites>$/u.exec(
      withoutDeclaration,
    );
    if (suites) {
      const attributes = suites[1] ?? "";
      totals.tests += readXmlNumberAttribute(attributes, "tests");
      totals.failures += readXmlNumberAttribute(attributes, "failures");
      totals.errors += readXmlNumberAttribute(attributes, "errors");
      totals.skipped += readXmlNumberAttribute(attributes, "skipped");
      totals.time += readXmlNumberAttribute(attributes, "time");
      bodies.push((suites[2] ?? "").trim());
      continue;
    }

    const suite = /^<testsuite\b([^>]*)>[\s\S]*<\/testsuite>$/u.exec(
      withoutDeclaration,
    );
    if (suite) {
      const attributes = suite[1] ?? "";
      totals.tests += readXmlNumberAttribute(attributes, "tests");
      totals.failures += readXmlNumberAttribute(attributes, "failures");
      totals.errors += readXmlNumberAttribute(attributes, "errors");
      totals.skipped += readXmlNumberAttribute(attributes, "skipped");
      totals.time += readXmlNumberAttribute(attributes, "time");
    }
    bodies.push(withoutDeclaration);
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites tests="${totals.tests}" failures="${totals.failures}" errors="${totals.errors}" skipped="${totals.skipped}" time="${
      formatXmlNumber(totals.time)
    }">`,
    ...bodies.filter((body) => body.length > 0),
    "</testsuites>",
    "",
  ].join("\n");
}

async function mergeJunitReports(
  paths: readonly string[],
  outputPath: string,
  { allowMissingReports = false }: { allowMissingReports?: boolean } = {},
): Promise<number> {
  const code = `
const { mergeDenoJunitReports } = await import("./scripts/test/run-test-file.ts");
const paths = ${JSON.stringify(paths)};
const outputPath = ${JSON.stringify(outputPath)};
const allowMissingReports = ${JSON.stringify(allowMissingReports)};
const reports = [];
for (const path of paths) {
  try {
    reports.push(await Deno.readTextFile(path));
  } catch (error) {
    if (!allowMissingReports || !(error instanceof Deno.errors.NotFound)) {
      throw error;
    }
  }
}
if (reports.length > 0) {
  const mergedReport = mergeDenoJunitReports(reports);
  if (outputPath === "-") {
    await Deno.stdout.write(new TextEncoder().encode(mergedReport));
  } else {
    await Deno.writeTextFile(outputPath, mergedReport);
  }
}
await Promise.all(paths.map((path) => Deno.remove(path).catch(() => {})));
`;
  const command = new Deno.Command("deno", {
    args: ["eval", code],
    clearEnv: true,
    env: buildTestProcessEnv(Deno.env.toObject(), UNIT_DENO_TEST_ENV),
    stdout: "inherit",
    stderr: "inherit",
  });
  const status = await command.spawn().status;
  return status.success ? 0 : status.code;
}

export interface TestFileCommandStatus {
  code: number;
  success: boolean;
}

export interface TestFileCommandRunOptions {
  commandArgs: string[];
  environment: Readonly<Record<string, string>>;
  redirectTestStdoutToStderr: boolean;
}

export type TestFileCommandRunner = (
  options: TestFileCommandRunOptions,
) => Promise<TestFileCommandStatus>;

async function runDenoTestFileCommand(
  {
    commandArgs,
    environment,
    redirectTestStdoutToStderr,
  }: TestFileCommandRunOptions,
): Promise<TestFileCommandStatus> {
  const command = new Deno.Command("deno", {
    args: commandArgs,
    clearEnv: true,
    env: buildTestProcessEnv(Deno.env.toObject(), environment),
    stdout: redirectTestStdoutToStderr ? "piped" : "inherit",
    stderr: "inherit",
  });
  return redirectTestStdoutToStderr
    ? await (async () => {
      const output = await command.output();
      if (output.stdout.length > 0) await Deno.stderr.write(output.stdout);
      return output;
    })()
    : await command.spawn().status;
}

export async function runTestFileCommandGroups(
  {
    commandArgGroups,
    environment,
    redirectTestStdoutToStderr,
    runCommand = runDenoTestFileCommand,
  }: {
    commandArgGroups: string[][];
    environment: Readonly<Record<string, string>>;
    redirectTestStdoutToStderr: boolean;
    runCommand?: TestFileCommandRunner;
  },
): Promise<number | undefined> {
  let failedExitCode: number | undefined;
  for (const commandArgs of commandArgGroups) {
    const status = await runCommand({
      commandArgs,
      environment,
      redirectTestStdoutToStderr,
    });
    if (!status.success && failedExitCode === undefined) {
      failedExitCode = status.code;
    }
  }
  return failedExitCode;
}

async function main(): Promise<void> {
  let targets: string[];
  let commandArgGroups: string[][];
  try {
    targets = getPositionalTestTargets(Deno.args);
    commandArgGroups = buildTestFileCommandArgGroups(Deno.args);
  } catch (error) {
    if (!(error instanceof TestFileUsageError)) throw error;
    console.error(error.message);
    Deno.exit(2);
  }
  let junitMerge:
    | { requestedPath: string; temporaryPaths: string[] }
    | undefined;
  const requestedJunitPath = getJunitPath(Deno.args);
  if (
    requestedJunitPath && commandArgGroups.length > 1 &&
    !hasDenoNoRun(Deno.args)
  ) {
    const temporaryPaths = buildTemporaryJunitPaths(
      requestedJunitPath,
      commandArgGroups.length,
    );
    const rewritten = rewriteSplitJunitPathForCommandArgGroups(
      commandArgGroups,
      temporaryPaths,
    );
    commandArgGroups = rewritten.commandArgGroups;
    junitMerge = { requestedPath: requestedJunitPath, temporaryPaths };
  }

  const environment =
    targets.some((target) =>
        isIntegrationTarget(target, TEST_TARGET_FILE_SYSTEM)
      )
      ? DENO_TEST_ENV
      : UNIT_DENO_TEST_ENV;
  const redirectTestStdoutToStderr = junitMerge?.requestedPath === "-";
  const failedExitCode = await runTestFileCommandGroups({
    commandArgGroups,
    environment,
    redirectTestStdoutToStderr,
  });
  if (junitMerge) {
    const mergeExitCode = await mergeJunitReports(
      junitMerge.temporaryPaths,
      junitMerge.requestedPath,
      { allowMissingReports: failedExitCode !== undefined },
    );
    if (mergeExitCode !== 0 && failedExitCode === undefined) {
      Deno.exit(mergeExitCode);
    }
  }
  if (failedExitCode !== undefined) Deno.exit(failedExitCode);
}

if (import.meta.main) {
  await main();
}

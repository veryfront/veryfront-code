import { walk } from "#std/fs/walk";

export interface ShardSpec {
  index: number;
  total: number;
}

export interface DenoTestCommandOptions {
  coverageDir: string;
  files: string[];
}

interface LcovLineRecord {
  covered: number;
  line: number;
}

const UNIT_COVERAGE_ROOTS = ["src", "cli"];
const UNIT_COVERAGE_ENV = {
  VF_DISABLE_LRU_INTERVAL: "1",
  SSR_TRANSFORM_PER_PROJECT_LIMIT: "0",
  REVALIDATION_PER_PROJECT_LIMIT: "0",
  NODE_ENV: "production",
  LOG_FORMAT: "text",
};

export function parseShardSpec(value: string): ShardSpec {
  const match = /^(\d+)\/(\d+)$/.exec(value);
  const index = Number(match?.[1]);
  const total = Number(match?.[2]);

  if (
    !match || !Number.isInteger(index) || !Number.isInteger(total) ||
    total < 1 || index < 1 || index > total
  ) {
    throw new Error(
      `Invalid shard spec "${value}". Expected N/T with 1 <= N <= T.`,
    );
  }

  return { index, total };
}

export function selectShardFiles(files: string[], shard: ShardSpec): string[] {
  return [...files]
    .sort((a, b) => a.localeCompare(b))
    .filter((_, index) => index % shard.total === shard.index - 1);
}

export async function collectUnitCoverageTestFiles(): Promise<string[]> {
  const files: string[] = [];

  for (const root of UNIT_COVERAGE_ROOTS) {
    if (!(await exists(root))) continue;

    for await (
      const entry of walk(root, {
        includeDirs: false,
        exts: [".ts"],
      })
    ) {
      const normalizedPath = entry.path.replaceAll("\\", "/");
      if (!isUnitCoverageTestFile(normalizedPath)) continue;
      files.push(normalizedPath);
    }
  }

  return files.sort((a, b) => a.localeCompare(b));
}

export function buildDenoTestCommandArgs(
  options: DenoTestCommandOptions,
): string[] {
  return [
    "test",
    "--preload=src/schemas/_test-setup.ts",
    "--no-check",
    "--parallel",
    "--fail-fast",
    "--allow-all",
    "--v8-flags=--max-old-space-size=8192",
    `--coverage=${options.coverageDir}`,
    "--coverage-raw-data-only",
    "--ignore=tests",
    "--ignore=src/workflow/__tests__",
    "--unstable-worker-options",
    "--unstable-net",
    ...options.files,
  ];
}

export function buildCoverageCommandArgs(profileDirs: string[]): string[] {
  return [
    "coverage",
    ...profileDirs,
    "--include=src/",
    "--exclude=tests",
    "--exclude=src/**/*_test.ts",
    "--exclude=src/**/*_test.tsx",
    "--exclude=src/**/*.test.ts",
    "--exclude=src/**/*.test.tsx",
    "--lcov",
  ];
}

export function mergeLcovReports(reports: string[]): string {
  const files = new Map<string, Map<number, number>>();

  for (const report of reports) {
    let currentFile: string | undefined;

    for (const line of report.split(/\r?\n/)) {
      if (line.startsWith("SF:")) {
        currentFile = line.slice(3).trim();
        if (!files.has(currentFile)) {
          files.set(currentFile, new Map());
        }
        continue;
      }

      if (!currentFile || !line.startsWith("DA:")) continue;

      const record = parseLcovLine(line);
      if (!record) continue;

      const lines = files.get(currentFile);
      if (!lines) continue;

      lines.set(record.line, (lines.get(record.line) ?? 0) + record.covered);
    }
  }

  return [...files.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, lines]) => {
      const sortedLines = [...lines.entries()].sort(([a], [b]) => a - b);
      const coveredLines = sortedLines.filter(([, hits]) => hits > 0).length;

      return [
        `SF:${file}`,
        ...sortedLines.map(([line, hits]) => `DA:${line},${hits}`),
        `LH:${coveredLines}`,
        `LF:${sortedLines.length}`,
        "end_of_record",
      ].join("\n");
    })
    .join("\n");
}

async function runShard(args: string[]): Promise<void> {
  const shardValue = readOption(args, "--shard");
  const coverageDir = readOption(args, "--coverage-dir") ?? "coverage";
  const shard = parseShardSpec(shardValue ?? "");

  await removeIfExists(coverageDir);
  await runDeno(["task", "generate"]);

  const files = selectShardFiles(await collectUnitCoverageTestFiles(), shard);
  if (files.length === 0) {
    throw new Error(
      `Coverage shard ${shard.index}/${shard.total} selected no test files.`,
    );
  }

  await runDeno(
    buildDenoTestCommandArgs({ coverageDir, files }),
    UNIT_COVERAGE_ENV,
  );

  await clearEmptyCoverageProfileJson(coverageDir);
  const lcov = await captureDeno(buildCoverageCommandArgs([coverageDir]));
  await clearCoverageProfileJson(coverageDir);
  await Deno.writeTextFile(`${coverageDir}/lcov.info`, lcov);
}

async function runMerge(args: string[]): Promise<void> {
  const threshold = Number(readOption(args, "--threshold") ?? "68");
  const coveragePaths = args.filter((arg) => !arg.startsWith("--"));

  if (!Number.isFinite(threshold)) {
    throw new Error("Coverage threshold must be a number.");
  }
  if (coveragePaths.length === 0) {
    throw new Error("At least one LCOV file or directory is required.");
  }

  await removeIfExists("coverage");
  await Deno.mkdir("coverage", { recursive: true });

  const lcovFiles = await collectLcovFiles(coveragePaths);
  if (lcovFiles.length === 0) {
    throw new Error("No LCOV files found to merge.");
  }

  const lcov = mergeLcovReports(
    await Promise.all(lcovFiles.map((path) => Deno.readTextFile(path))),
  );
  await Deno.writeTextFile("coverage/lcov.info", lcov);
  await runDeno([
    "run",
    "--allow-read",
    "scripts/lint/check-coverage.ts",
    String(threshold),
  ]);
}

function parseLcovLine(line: string): LcovLineRecord | undefined {
  const match = /^DA:(\d+),(\d+)/.exec(line);
  if (!match) return undefined;

  const lineNumber = Number(match[1]);
  const covered = Number(match[2]);
  if (!Number.isInteger(lineNumber) || !Number.isFinite(covered)) {
    return undefined;
  }

  return { line: lineNumber, covered };
}

function isUnitCoverageTestFile(path: string): boolean {
  return path.endsWith(".test.ts") &&
    !path.endsWith(".integration.test.ts") &&
    !path.startsWith("src/workflow/__tests__/");
}

function readOption(args: string[], name: string): string | undefined {
  const prefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);

  const index = args.indexOf(name);
  if (index >= 0) return args[index + 1];
  return undefined;
}

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

async function collectLcovFiles(paths: string[]): Promise<string[]> {
  const files: string[] = [];

  for (const path of paths) {
    const stat = await Deno.stat(path);
    if (stat.isFile) {
      files.push(path);
      continue;
    }

    for await (
      const entry of walk(path, {
        includeDirs: false,
        exts: [".info"],
      })
    ) {
      if (entry.name === "lcov.info") {
        files.push(entry.path);
      }
    }
  }

  return files.sort((a, b) => a.localeCompare(b));
}

async function clearCoverageProfileJson(path: string): Promise<void> {
  for await (
    const entry of walk(path, {
      includeDirs: false,
      exts: [".json"],
    })
  ) {
    await Deno.remove(entry.path);
  }
}

async function clearEmptyCoverageProfileJson(path: string): Promise<void> {
  for await (
    const entry of walk(path, {
      includeDirs: false,
      exts: [".json"],
    })
  ) {
    const stat = await Deno.stat(entry.path);
    if (stat.size === 0) {
      await Deno.remove(entry.path);
    }
  }
}

async function removeIfExists(path: string): Promise<void> {
  try {
    await Deno.remove(path, { recursive: true });
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
}

async function runDeno(
  args: string[],
  env?: Record<string, string>,
): Promise<void> {
  const child = new Deno.Command("deno", {
    args,
    env,
    stdout: "inherit",
    stderr: "inherit",
  }).spawn();
  const status = await child.status;
  if (!status.success) {
    throw new Error(`deno ${args.join(" ")} exited with ${status.code}`);
  }
}

async function captureDeno(args: string[]): Promise<string> {
  const output = await new Deno.Command("deno", {
    args,
    stdout: "piped",
    stderr: "inherit",
  }).output();
  if (!output.success) {
    throw new Error(`deno ${args.join(" ")} exited with ${output.code}`);
  }
  return new TextDecoder().decode(output.stdout);
}

if (import.meta.main) {
  const [mode, ...rawArgs] = Deno.args.filter((arg) => arg !== "--");
  if (mode === "shard") {
    await runShard(rawArgs);
  } else if (mode === "merge") {
    await runMerge(rawArgs);
  } else {
    throw new Error("Usage: coverage-ci.ts <shard|merge> [options]");
  }
}

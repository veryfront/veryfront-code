import { walk } from "#std/fs/walk";
import { dirname, fromFileUrl, resolve, toFileUrl } from "#std/path";
import {
  buildTestProcessEnv,
  LOOPBACK_TEST_PERMISSIONS,
  partitionDenoSuiteFiles,
  shouldRunDenoBatchInParallel,
  UNIT_DENO_TEST_ENV,
} from "./suites.ts";

export { LOOPBACK_ALLOW_NET } from "./suites.ts";

export interface ShardSpec {
  index: number;
  total: number;
}

export interface DenoTestCommandOptions {
  coverageDir: string;
  files: readonly string[];
  parallel?: boolean;
}

interface LcovLineRecord {
  covered: number;
  line: number;
}

const UNIT_COVERAGE_ENV = UNIT_DENO_TEST_ENV;
const GENERATED_MDX_CACHE_PREFIX =
  "/home/runner/.cache/veryfront/veryfront-mdx-esm/";

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

export function buildDenoTestCommandArgs(
  options: DenoTestCommandOptions,
): string[] {
  return [
    "test",
    "--preload=src/testing/preload.ts",
    "--no-check",
    ...((options.parallel ?? true) ? ["--parallel"] : []),
    // Leaks here are load-dependent and do not reproduce on demand, so the
    // first failure has to carry the stack rather than advise a rerun.
    "--trace-leaks",
    ...LOOPBACK_TEST_PERMISSIONS,
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

export function buildCoverageCommandArgs(
  profileDirs: string[],
  repositoryRoot = fromFileUrl(new URL("../../", import.meta.url)),
): string[] {
  const sourceRoot = toFileUrl(repositoryRoot.replace(/[\\/]+$/, "") + "/").href
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [
    "coverage",
    ...profileDirs,
    `--include=^${sourceRoot}src/`,
    // cli/ ships as a published export and the unit suite already runs its 184
    // test files on every shard; without this their coverage was collected and
    // then discarded at report time. Adding it puts 267 cli/ source files and
    // 29,263 lines into the report and into the 80% gate.
    `--include=^${sourceRoot}cli/`,
    // `--exclude` takes a regex matched against the file URL, not a glob. Two
    // consequences, both verified against deno 2.7.7:
    //
    // 1. Bare `tests` also matched `cli/mcp/tools/run-tests-tool.ts`, the
    //    published module behind the `vf_run_tests` MCP tool. It would have
    //    dropped out of the report the moment cli/ entered it. Anchoring on
    //    slashes keeps the two test directories out and leaves production
    //    filenames alone.
    // 2. Glob-shaped patterns such as `src/**/*.test.ts` never compile to
    //    anything that matches, so they were doing nothing. Test files stay out
    //    because deno always applies its own `test\.(js|mjs|ts|jsx|tsx)$`
    //    exclusion on top of these, which covers both `x.test.ts` and
    //    `x_test.ts`. Do not add glob patterns back here.
    "--exclude=/tests/",
    "--exclude=/__tests__/",
    "--lcov",
  ];
}

const WORKSPACE_RECORD_PREFIX = "# veryfront-coverage-workspace: ";

export interface LcovArtifactReport {
  path: string;
  content: string;
}

type NormalizedLcovSource =
  | { kind: "source"; path: string }
  | { kind: "drop-generated-cache" };

function validateProducerWorkspace(value: unknown): string {
  if (
    typeof value !== "string" || !/^(?:\/|[A-Za-z]:[\\/])/.test(value) ||
    /[\r\n\0]/.test(value) ||
    value.replaceAll("\\", "/").split("/").some((part) =>
      part === "." || part === ".."
    )
  ) {
    throw new Error("Invalid LCOV producer workspace provenance.");
  }
  const root = value.replaceAll("\\", "/").replace(/\/+$/, "");
  if (!root || /^[A-Za-z]:$/.test(root)) {
    throw new Error("Invalid LCOV producer workspace provenance.");
  }
  return root;
}

export function annotateLcovWorkspace(
  report: string,
  workspace: string,
): string {
  const root = validateProducerWorkspace(workspace);
  return `${WORKSPACE_RECORD_PREFIX}${JSON.stringify(root)}\n${report}`;
}

/** Producer provenance applies only within its uploaded artifact directory. */
export function normalizeLcovArtifacts(
  reports: readonly LcovArtifactReport[],
  workspace: string,
  sourceExists: (relativePath: string) => boolean,
): string[] {
  const roots = new Map<string, string>();
  for (const report of reports) {
    const directory = dirname(resolve(report.path)).replaceAll("\\", "/");
    for (const line of report.content.split(/\r?\n/)) {
      if (!line.startsWith(WORKSPACE_RECORD_PREFIX)) continue;
      let value: unknown;
      try {
        value = JSON.parse(line.slice(WORKSPACE_RECORD_PREFIX.length));
      } catch {
        throw new Error("Invalid LCOV producer workspace provenance.");
      }
      const root = validateProducerWorkspace(value);
      for (const [scope, existing] of roots) {
        const related = directory === scope ||
          directory.startsWith(`${scope}/`) ||
          scope.startsWith(`${directory}/`);
        if (related && existing !== root) {
          throw new Error("Conflicting LCOV producer workspace provenance.");
        }
      }
      roots.set(directory, root);
    }
  }
  return reports.map((report) => {
    const directory = dirname(resolve(report.path)).replaceAll("\\", "/");
    const producer = [...roots].find(([scope]) =>
      directory === scope || directory.startsWith(`${scope}/`)
    )?.[1];
    return normalizeLcovSourcePaths(report.content, [
      workspace,
      ...githubWorkspaceRoots(workspace),
      ...(producer ? [producer] : []),
      ...(producer ? githubWorkspaceRoots(producer) : []),
    ], sourceExists);
  });
}

/**
 * Rewrite verified checkout prefixes, drop generated MDX cache records, and
 * fail closed when a path that should be a checkout source is missing.
 */
export function normalizeLcovSourcePaths(
  report: string,
  producerRoots: readonly string[],
  sourceExists: (relativePath: string) => boolean,
): string {
  const prefixes = producerRoots.map((root) =>
    validateProducerWorkspace(root) + "/"
  );
  const newline = report.includes("\r\n") ? "\r\n" : "\n";
  const output: string[] = [];
  let keepRecord = true;

  for (const line of report.split(/\r?\n/)) {
    if (line.startsWith("SF:")) {
      const source = normalizeLcovSource(line.slice(3), prefixes, sourceExists);
      if (source.kind === "drop-generated-cache") {
        keepRecord = false;
        continue;
      }
      keepRecord = true;
      output.push(`SF:${source.path}`);
      continue;
    }
    if (!keepRecord) {
      if (line === "end_of_record") keepRecord = true;
      continue;
    }
    output.push(line);
  }

  return output.join(newline);
}

function normalizeLcovSource(
  source: string,
  prefixes: readonly string[],
  sourceExists: (relativePath: string) => boolean,
): NormalizedLcovSource {
  const portable = source.replaceAll("\\", "/");
  if (portable.startsWith(GENERATED_MDX_CACHE_PREFIX)) {
    return { kind: "drop-generated-cache" };
  }

  if (!portable.startsWith("/") && !/^[A-Za-z]:\//.test(portable)) {
    const relative = normalizeRelativeLcovPath(portable);
    if (!sourceExists(relative)) {
      throw new Error(
        `LCOV source path does not exist in the project: ${relative}`,
      );
    }
    return { kind: "source", path: relative };
  }

  const prefix = prefixes.find((candidate) => portable.startsWith(candidate));
  if (prefix) {
    const relative = normalizeRelativeLcovPath(portable.slice(prefix.length));
    if (!sourceExists(relative)) {
      throw new Error(
        `LCOV source path does not exist in the project: ${relative}`,
      );
    }
    return { kind: "source", path: relative };
  }

  const githubCheckout = /^\/home\/runner\/_?work\/([^/]+)\/\1\/(.+)$/.exec(
    portable,
  );
  if (githubCheckout?.[2]) {
    const relative = normalizeRelativeLcovPath(githubCheckout[2]);
    if (!sourceExists(relative)) {
      throw new Error(
        `LCOV source path does not exist in the project: ${relative}`,
      );
    }
    return { kind: "source", path: relative };
  }

  const windowsGithubCheckout = /^[A-Za-z]:\/a\/([^/]+)\/\1\/(.+)$/.exec(
    portable,
  );
  if (windowsGithubCheckout?.[2]) {
    const relative = normalizeRelativeLcovPath(windowsGithubCheckout[2]);
    if (!sourceExists(relative)) {
      throw new Error(
        `LCOV source path does not exist in the project: ${relative}`,
      );
    }
    return { kind: "source", path: relative };
  }

  throw new Error(
    `LCOV source is outside a recognized repository checkout: ${source}`,
  );
}

function normalizeRelativeLcovPath(path: string): string {
  const parts: string[] = [];
  for (const part of path.replaceAll("\\", "/").split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) {
        throw new Error(`LCOV source path escapes the project: ${path}`);
      }
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  if (parts.length === 0) {
    throw new Error(`LCOV source path is empty after normalization: ${path}`);
  }
  return parts.join("/");
}

function githubWorkspaceRoots(root: string): string[] {
  const portable = root.replaceAll("\\", "/").replace(/\/+$/, "");
  const match = /^\/home\/runner\/(_?work)\/([^/]+)\/\2$/.exec(portable);
  if (!match?.[1] || !match[2]) return [];
  const alternate = match[1] === "_work" ? "work" : "_work";
  return [`/home/runner/${alternate}/${match[2]}/${match[2]}`];
}

export function mergeLcovReports(reports: string[]): string {
  const blockLayouts = reports.map(collectBranchBlockLayouts);
  const shiftedBlockLines = findShiftedBranchBlockLines(blockLayouts);
  const files = new Map<string, {
    lines: Map<number, number>;
    branches: Map<string, { key: [number, number, number]; hits: number }>;
  }>();

  for (let reportIndex = 0; reportIndex < reports.length; reportIndex++) {
    const report = reports[reportIndex];
    if (report === undefined) continue;
    let currentFile: string | undefined;

    for (const line of report.split(/\r?\n/)) {
      if (line.startsWith("SF:")) {
        currentFile = line.slice(3).trim();
        if (!files.has(currentFile)) {
          files.set(currentFile, { lines: new Map(), branches: new Map() });
        }
        continue;
      }

      if (line === "end_of_record") {
        currentFile = undefined;
        continue;
      }
      if (!currentFile) continue;
      const file = files.get(currentFile);
      if (!file) continue;

      if (line.startsWith("DA:")) {
        const record = parseLcovLine(line);
        if (record) {
          file.lines.set(
            record.line,
            (file.lines.get(record.line) ?? 0) + record.covered,
          );
        }
      } else if (line.startsWith("BRDA:")) {
        // Deno emits numeric BRDA:<line>,<block>,<branch>,<hits|-> only. Other
        // forms (for example lcov 2.x `e`-prefixed exception blocks) are
        // intentionally dropped. Deno derives block ids from V8 function
        // indexes, which can differ between otherwise equivalent reports. If
        // every report has the same block shape on a line but the ids differ,
        // use each block's source-order ordinal so Sonar sees one stable
        // condition set. If a report omits a block or the branch shapes
        // differ, ordinals would not line up, so the emitted ids are kept.
        const match = /^BRDA:(\d+),(\d+),(\d+),(\d+|-)\s*$/.exec(line);
        if (!match) continue;
        const lineNumber = Number(match[1]);
        const emittedBlock = Number(match[2]);
        const layout = blockLayouts[reportIndex]?.get(currentFile)?.get(
          lineNumber,
        );
        const blockOrdinal = layout?.ids.indexOf(emittedBlock) ?? -1;
        const block = shiftedBlockLines.get(currentFile)?.has(lineNumber) &&
            blockOrdinal >= 0
          ? blockOrdinal
          : emittedBlock;
        const key: [number, number, number] = [
          lineNumber,
          block,
          Number(match[3]),
        ];
        const hits = match[4] === "-" ? 0 : Number(match[4]);
        const id = key.join(",");
        const existing = file.branches.get(id);
        file.branches.set(id, { key, hits: (existing?.hits ?? 0) + hits });
      }
    }
  }

  return [...files.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, { lines, branches }]) => {
      const sortedLines = [...lines.entries()].sort(([a], [b]) => a - b);
      const coveredLines = sortedLines.filter(([, hits]) => hits > 0).length;

      const sortedBranches = [...branches.values()].sort((
        { key: a },
        { key: b },
      ) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
      const branchRecords = sortedBranches.length === 0 ? [] : [
        ...sortedBranches.map(({ key, hits }) =>
          `BRDA:${key.join(",")},${hits}`
        ),
        `BRF:${sortedBranches.length}`,
        `BRH:${sortedBranches.filter(({ hits }) => hits > 0).length}`,
      ];

      return [
        `SF:${file}`,
        ...sortedLines.map(([line, hits]) => `DA:${line},${hits}`),
        `LH:${coveredLines}`,
        `LF:${sortedLines.length}`,
        ...branchRecords,
        "end_of_record",
      ].join("\n");
    })
    .join("\n");
}

interface BranchBlockLayout {
  /** Emitted block ids on the line, in source order. */
  ids: number[];
  /** Branch count of each block, in the same order. */
  branchCounts: number[];
}

function collectBranchBlockLayouts(
  report: string,
): Map<string, Map<number, BranchBlockLayout>> {
  const blocks = new Map<string, Map<number, Map<number, Set<number>>>>();
  let currentFile: string | undefined;

  for (const line of report.split(/\r?\n/)) {
    if (line.startsWith("SF:")) {
      currentFile = line.slice(3).trim();
      continue;
    }
    if (line === "end_of_record") {
      currentFile = undefined;
      continue;
    }
    if (!currentFile) continue;

    const match = /^BRDA:(\d+),(\d+),(\d+),(?:\d+|-)\s*$/.exec(line);
    if (!match) continue;
    const lineNumber = Number(match[1]);
    const block = Number(match[2]);
    const fileBlocks = blocks.get(currentFile) ??
      new Map<number, Map<number, Set<number>>>();
    const lineBlocks = fileBlocks.get(lineNumber) ??
      new Map<number, Set<number>>();
    const branches = lineBlocks.get(block) ?? new Set<number>();
    branches.add(Number(match[3]));
    lineBlocks.set(block, branches);
    fileBlocks.set(lineNumber, lineBlocks);
    blocks.set(currentFile, fileBlocks);
  }

  return new Map(
    [...blocks].map(([file, lines]) => [
      file,
      new Map(
        [...lines].map(([line, lineBlocks]) => {
          const ids = [...lineBlocks.keys()].sort((a, b) => a - b);
          return [line, {
            ids,
            branchCounts: ids.map((id) => lineBlocks.get(id)?.size ?? 0),
          }];
        }),
      ),
    ]),
  );
}

/**
 * Lines whose block ids differ between reports while every report carries the
 * same blocks in shape: the same number of blocks, each with the same number
 * of branches in source order. Only those can be aligned by source-order
 * ordinal. A line where some report omits a block, or where the branch shapes
 * differ, keeps its emitted ids, because an ordinal there could attribute one
 * condition's hits to another. LCOV carries no column data, so a line with one
 * shifted block and a line whose shards each saw a different same-shaped
 * condition look identical; the shifted-id case is the one Deno produces.
 */
function findShiftedBranchBlockLines(
  layouts: Map<string, Map<number, BranchBlockLayout>>[],
): Map<string, Set<number>> {
  const seen = new Map<string, { ids: string; shape: string }>();
  const differing = new Map<string, { file: string; line: number }>();
  const mismatched = new Set<string>();

  for (const layout of layouts) {
    for (const [file, lines] of layout) {
      for (const [line, blocks] of lines) {
        const id = `${file}\0${line}`;
        const ids = blocks.ids.join(",");
        const shape = blocks.branchCounts.join(",");
        const first = seen.get(id);
        if (first === undefined) {
          seen.set(id, { ids, shape });
          continue;
        }
        if (first.shape !== shape) mismatched.add(id);
        if (first.ids !== ids) differing.set(id, { file, line });
      }
    }
  }

  const shifted = new Map<string, Set<number>>();
  for (const [id, { file, line }] of differing) {
    if (mismatched.has(id)) continue;
    const fileLines = shifted.get(file) ?? new Set<number>();
    fileLines.add(line);
    shifted.set(file, fileLines);
  }
  return shifted;
}

async function runShard(args: string[]): Promise<void> {
  const shardValue = readOption(args, "--shard");
  const coverageDir = readOption(args, "--coverage-dir") ?? "coverage";
  const shard = parseShardSpec(shardValue ?? "");

  await removeIfExists(coverageDir);
  await runDeno(["task", "generate"]);

  // Keep merge mode usable with `--no-npm`: the planner owns shard selection,
  // but its layout validator imports the Babel parser and is only needed here.
  const { planSuiteFiles } = await import("./run-suite.ts");
  const { files } = await planSuiteFiles({ suite: "coverage:unit", shard });

  for (const batch of partitionDenoSuiteFiles(files, null)) {
    await runDeno(
      buildDenoTestCommandArgs({
        coverageDir,
        files: batch,
        parallel: shouldRunDenoBatchInParallel(true, batch),
      }),
      { ...UNIT_COVERAGE_ENV },
    );
  }

  await clearEmptyCoverageProfileJson(coverageDir);
  const lcov = await captureDeno(buildCoverageCommandArgs([coverageDir]));
  await clearCoverageProfileJson(coverageDir);
  await Deno.writeTextFile(
    `${coverageDir}/lcov.info`,
    prepareProducedLcov(lcov),
  );
}

function checkoutSourceExists(relativePath: string): boolean {
  try {
    return Deno.statSync(relativePath).isFile;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

function prepareProducedLcov(report: string): string {
  const workspace = Deno.cwd();
  return annotateLcovWorkspace(
    normalizeLcovSourcePaths(report, [workspace], checkoutSourceExists),
    workspace,
  );
}

async function runReport(args: string[]): Promise<void> {
  const coverageDir = args[0];
  if (!coverageDir) {
    throw new Error("A coverage profile directory is required.");
  }
  const lcov = await captureDeno(buildCoverageCommandArgs([coverageDir]));
  await Deno.writeTextFile(
    `${coverageDir}/lcov.info`,
    prepareProducedLcov(lcov),
  );
}

async function runMerge(args: string[]): Promise<void> {
  const threshold = Number(readOption(args, "--threshold") ?? "80");
  const coveragePaths = args.filter((arg, index) =>
    !arg.startsWith("--") && args[index - 1] !== "--threshold"
  );

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

  // Coverage producers run on both hosted and self-hosted checkouts. Normalize
  // before merging so identical source files share records across runner roots.
  const reports = await Promise.all(lcovFiles.map(async (path) => ({
    path,
    content: await Deno.readTextFile(path),
  })));
  const normalizedReports = normalizeLcovArtifacts(
    reports,
    Deno.cwd(),
    checkoutSourceExists,
  );
  const lcov = mergeLcovReports(normalizedReports);
  await Deno.writeTextFile("coverage/lcov.info", lcov);
  await runDeno([
    "run",
    "--allow-read",
    fromFileUrl(new URL("../lint/check-coverage.ts", import.meta.url)),
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

function readOption(args: string[], name: string): string | undefined {
  const prefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);

  const index = args.indexOf(name);
  if (index >= 0) return args[index + 1];
  return undefined;
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
    clearEnv: true,
    env: buildTestProcessEnv(Deno.env.toObject(), env),
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
    clearEnv: true,
    env: buildTestProcessEnv(Deno.env.toObject()),
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
  } else if (mode === "report") {
    await runReport(rawArgs);
  } else {
    throw new Error("Usage: coverage-ci.ts <shard|merge|report> [options]");
  }
}

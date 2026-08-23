/**
 * The ratchet engine behind the baseline lint scripts.
 *
 * A ratchet walks the repository, runs a matcher over every selected file,
 * counts what it finds, compares the counts with a committed baseline, and
 * fails when any count grew. Every script in this directory that does that —
 * sanitizer opt-outs, skipped tests, focused tests, cwd-relative test reads,
 * anti-slop type patterns, unawaited cleanup calls — is a matcher plugged into
 * this module. The matcher is the only thing a script owns; the walk, the
 * ignore policy, the baseline storage, the comparison, the report, and the CLI
 * flags are shared, so they cannot drift apart again.
 *
 * ## Roots
 *
 * The repository root is resolved from `import.meta.url`, never from the
 * process cwd, so a ratchet scans the same tree whether it runs from the repo
 * root, a subdirectory, or a task. The default scan roots are read from
 * `deno.json` at runtime: `test.include` for test-surface ratchets and
 * `lint.include` / `lint.exclude` for source-surface ratchets. A root that
 * does not exist is a configuration error and fails loudly — a silent
 * `0/N ok` from a missing directory is a green check that guards nothing.
 *
 * ## Baselines
 *
 * Four storage shapes, one comparison policy:
 *
 *  - `zero`            — nothing is allowed; every finding is a failure.
 *  - `total`           — one integer kept as an `export const` in the script.
 *  - `per-file`        — JSON `{ "path": count }`.
 *  - `per-group-file`  — JSON `{ "rule": { "path": count } }`.
 *
 * Growth of any key is a regression (exit 1, offenders listed as
 * `file:line`). Shrinkage passes and prints the exact new baseline to lock in.
 * A finding marked `blocking` is never baselined and always fails.
 *
 * ## CLI
 *
 *  - `--print-baseline`  print the baseline the current tree would lock in
 *  - `--update`          write that baseline (needs `--allow-write`)
 *  - `--list`            print every finding before the verdict
 *
 * Both baseline flags refuse (exit 1, nothing written) while a file cannot be
 * parsed or a `blocking` finding exists — a baseline produced then would look
 * like a fix while the check itself still fails.
 *
 * Exit codes: 0 ok or improved, 1 regression / blocking finding / unparsable
 * file, 2 configuration error (missing root, malformed baseline, bad flag).
 */

import { fromFileUrl } from "#std/path";

// ---------------------------------------------------------------------------
// Root resolution
// ---------------------------------------------------------------------------

/**
 * Absolute repository root with a trailing separator.
 *
 * `fromFileUrl`, not `URL.pathname`: pathname keeps the URL's leading slash
 * and percent encoding, so a Windows checkout would scan `/C:/...`.
 */
export const REPO_ROOT: string = fromFileUrl(
  new URL("../../", import.meta.url),
);

/**
 * Baseline key for a scanned file: repo-relative, always posix separators, so
 * a Windows checkout produces the same keys a Linux one does.
 */
export function toRepoRelative(
  file: string,
  repoRoot: string = REPO_ROOT,
): string {
  return file.slice(repoRoot.length).replaceAll("\\", "/");
}

/**
 * Which part of the tree a ratchet scans.
 *
 *  - `"test"` — the directories `deno.json` `test.include` declares.
 *  - `"lint"` — the directories behind `deno.json` `lint.include`, minus
 *    `lint.exclude` prefixes.
 *  - explicit — repo-relative directories plus optional exclude prefixes.
 */
export type ScanScope =
  | "test"
  | "lint"
  | { roots: readonly string[]; excludes?: readonly string[] };

export interface ResolvedScope {
  roots: string[];
  /** Repo-relative prefixes (`src/studio/bridge/`) that are not scanned. */
  excludes: string[];
}

/** Leading directory of a `deno.json` include entry (`src/**\/*.ts` -> `src`). */
function includeRoot(entry: string): string {
  const [first] = entry.split("/");
  if (first === undefined || first === "" || first.includes("*")) {
    throw new Error(`deno.json include entry has no directory root: ${entry}`);
  }
  return first;
}

function stringList(value: unknown, where: string): string[] {
  if (
    !Array.isArray(value) || value.some((item) => typeof item !== "string")
  ) {
    throw new Error(`deno.json ${where} must be an array of strings`);
  }
  return value as string[];
}

export async function resolveScope(
  scope: ScanScope,
  repoRoot: string = REPO_ROOT,
): Promise<ResolvedScope> {
  if (typeof scope !== "string") {
    return { roots: [...scope.roots], excludes: [...(scope.excludes ?? [])] };
  }
  const config = JSON.parse(await Deno.readTextFile(`${repoRoot}deno.json`));
  const section = (config as Record<string, unknown>)[scope];
  if (typeof section !== "object" || section === null) {
    throw new Error(`deno.json has no "${scope}" section`);
  }
  const { include, exclude } = section as {
    include?: unknown;
    exclude?: unknown;
  };
  const roots = [
    ...new Set(stringList(include, `${scope}.include`).map(includeRoot)),
  ];
  const excludes = scope === "lint" && exclude !== undefined
    ? stringList(exclude, "lint.exclude")
    : [];
  return { roots, excludes };
}

// ---------------------------------------------------------------------------
// Walk
// ---------------------------------------------------------------------------

/** Directory names never descended into, at any depth under a scan root. */
export const IGNORED_DIRECTORY_NAMES: ReadonlySet<string> = new Set([
  "node_modules",
  "dist",
  "coverage",
]);

/** Dot-directories (`.git`, `.omc`, `.worktrees`, `.claude`) and emitted output. */
export function isIgnoredDirectory(name: string): boolean {
  return name.startsWith(".") || IGNORED_DIRECTORY_NAMES.has(name);
}

/** A configured scan root that is not a directory in this checkout. */
export class MissingScanRoot extends Error {
  constructor(readonly root: string, readonly repoRoot: string) {
    super(
      `Scan root "${root}" does not exist under ${repoRoot} — ` +
        `fix the ratchet's scope or deno.json include list.`,
    );
    this.name = "MissingScanRoot";
  }
}

export interface ScannedFile {
  /** Absolute path. */
  path: string;
  /** Repo-relative posix path — the baseline key. */
  relative: string;
}

export interface WalkOptions {
  scope: ScanScope;
  /** Which files the matcher runs on, by repo-relative path. */
  select: (relative: string) => boolean;
  repoRoot?: string;
}

/**
 * Every selected file under the scope's roots, sorted by relative path.
 *
 * Symlinks are not followed. Excluded prefixes prune both directories and
 * files. A missing root throws `MissingScanRoot` rather than contributing
 * zero files.
 */
export async function walkRepo(options: WalkOptions): Promise<ScannedFile[]> {
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  const { roots, excludes } = await resolveScope(options.scope, repoRoot);
  const files: ScannedFile[] = [];
  const isExcluded = (relative: string) =>
    excludes.some((prefix) => relative.startsWith(prefix));

  const collect = async (dir: string): Promise<void> => {
    for await (const entry of Deno.readDir(dir)) {
      const path = `${dir}/${entry.name}`;
      const relative = toRepoRelative(path, repoRoot);
      if (entry.isDirectory) {
        if (isIgnoredDirectory(entry.name) || isExcluded(`${relative}/`)) {
          continue;
        }
        await collect(path);
      } else if (
        entry.isFile && !isExcluded(relative) && options.select(relative)
      ) {
        files.push({ path, relative });
      }
    }
  };

  for (const root of roots) {
    const dir = `${repoRoot}${root}`;
    let info: Deno.FileInfo;
    try {
      info = await Deno.stat(dir);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        throw new MissingScanRoot(root, repoRoot);
      }
      throw error;
    }
    if (!info.isDirectory) throw new MissingScanRoot(root, repoRoot);
    await collect(dir);
  }

  return files.sort((a, b) => a.relative.localeCompare(b.relative));
}

// ---------------------------------------------------------------------------
// Predicates and source helpers
// ---------------------------------------------------------------------------

/** The test-file rule the suite planner uses: `*.test.ts|tsx|mjs`. */
export function isTestFile(path: string): boolean {
  return /\.test\.(?:ts|tsx|mjs)$/.test(path);
}

/** Any TypeScript source, test or not, excluding declaration files. */
export function isTypeScriptFile(path: string): boolean {
  return /\.tsx?$/.test(path) && !path.endsWith(".d.ts");
}

/** Production TypeScript: `.ts`/`.tsx` that is neither a test nor a `.d.ts`. */
export function isSourceFile(path: string): boolean {
  return isTypeScriptFile(path) && !isTestFile(path);
}

/**
 * Blank out comments and string/template literals so a pattern spelled inside
 * one cannot match. Newlines are preserved, so line numbers computed on the
 * stripped text still point at the original source.
 */
export function stripCommentsAndStrings(text: string): string {
  const keepNewlines = (match: string) => match.replace(/[^\n]/g, "");
  let out = text.replace(/\/\*[\s\S]*?\*\//g, keepNewlines); // block comments
  out = out.replace(/(^|[^:])\/\/[^\n]*/g, "$1"); // line comments (keep http:// etc.)
  out = out.replace(/`(?:\\.|[^`])*`/gs, (m) => `\`${keepNewlines(m)}\``); // templates
  out = out.replace(/'(?:\\.|[^'\n])*'/g, "''"); // single-quoted
  out = out.replace(/"(?:\\.|[^"\n])*"/g, '""'); // double-quoted
  return out;
}

// ---------------------------------------------------------------------------
// Findings and baselines
// ---------------------------------------------------------------------------

export interface Finding {
  /** Repo-relative posix path. */
  file: string;
  /** 1-based line. */
  line: number;
  /** What was found, shown after `file:line` in reports. */
  message: string;
  /** Baseline group for `per-group-file` ratchets (the rule name). */
  group?: string;
  /** Never baselined: fails the run regardless of any recorded count. */
  blocking?: boolean;
}

/** Raised by a matcher when a file cannot be parsed, so the ratchet fails closed. */
export class ParseFailure extends Error {
  constructor(file: string, cause: unknown) {
    super(`${file}: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "ParseFailure";
  }
}

/** One finding per regex match, line by line. `pattern` must carry the `g` flag. */
export function findLineMatches(
  source: string,
  file: string,
  pattern: RegExp,
  message: string | ((match: RegExpExecArray) => string),
): Finding[] {
  if (!pattern.global) {
    throw new Error(`findLineMatches needs a global pattern: ${pattern}`);
  }
  const findings: Finding[] = [];
  source.split(/\r?\n/).forEach((text, index) => {
    pattern.lastIndex = 0;
    for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
      findings.push({
        file,
        line: index + 1,
        message: typeof message === "string" ? message : message(match),
      });
      if (match[0].length === 0) pattern.lastIndex += 1;
    }
  });
  return findings;
}

export function sortFindings(findings: readonly Finding[]): Finding[] {
  return [...findings].sort((a, b) =>
    a.file.localeCompare(b.file) || a.line - b.line ||
    a.message.localeCompare(b.message)
  );
}

export type BaselineKind = "zero" | "total" | "per-file" | "per-group-file";

export type BaselineStore =
  | { kind: "zero" }
  | {
    kind: "total";
    value: number;
    /** Name of the `export const` holding `value`, for `--update` and hints. */
    constant: string;
    /** `import.meta.url` of the module that declares the constant. */
    module: string;
  }
  | { kind: "per-file"; path: string }
  | { kind: "per-group-file"; path: string };

/** Counts keyed by file, `group file`, or `total`. */
export type Counts = Record<string, number>;

const TOTAL_KEY = "total";

export function keyOf(finding: Finding, kind: BaselineKind): string {
  switch (kind) {
    case "total":
    case "zero":
      return TOTAL_KEY;
    case "per-file":
      return finding.file;
    case "per-group-file":
      if (finding.group === undefined) {
        throw new Error(
          `per-group-file ratchet produced a finding without a group: ${finding.file}:${finding.line}`,
        );
      }
      return `${finding.group} ${finding.file}`;
  }
}

function sortedCounts(counts: Counts): Counts {
  return Object.fromEntries(
    Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)),
  );
}

export function countFindings(
  findings: readonly Finding[],
  kind: BaselineKind,
): Counts {
  const counts: Counts = {};
  for (const finding of findings) {
    const key = keyOf(finding, kind);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return sortedCounts(counts);
}

export interface CountDelta {
  key: string;
  then: number;
  now: number;
}

export interface Comparison {
  /** Keys whose count grew or appeared. The ratchet slipping backwards. */
  regressions: CountDelta[];
  /** Keys whose count shrank or vanished. The ratchet earning a new floor. */
  improvements: CountDelta[];
}

/**
 * Compare current counts with the baseline, key by key. A key already
 * carrying two findings must not quietly grow a third, and a key the baseline
 * never listed counts from zero.
 */
export function compareCounts(current: Counts, baseline: Counts): Comparison {
  const regressions: CountDelta[] = [];
  const improvements: CountDelta[] = [];
  const keys = [...new Set([...Object.keys(current), ...Object.keys(baseline)])]
    .sort((a, b) => a.localeCompare(b));
  for (const key of keys) {
    const now = current[key] ?? 0;
    const then = baseline[key] ?? 0;
    if (now > then) regressions.push({ key, then, now });
    else if (now < then) improvements.push({ key, then, now });
  }
  return { regressions, improvements };
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Validate a stored baseline and flatten it to `Counts`. */
export function parseBaseline(
  kind: BaselineKind,
  value: unknown,
  source: string,
): Counts {
  const invalid = (detail: string) =>
    new Error(`Invalid ${kind} baseline in ${source}: ${detail}`);
  switch (kind) {
    case "zero":
      return {};
    case "total":
      if (
        typeof value !== "number" || !Number.isInteger(value) || value < 0
      ) {
        throw invalid(`expected a non-negative integer, got ${String(value)}`);
      }
      return value === 0 ? {} : { [TOTAL_KEY]: value };
    case "per-file": {
      if (!isRecord(value)) throw invalid("expected { file: count }");
      for (const [file, count] of Object.entries(value)) {
        if (!isPositiveInteger(count)) {
          throw invalid(`count for ${file} must be a positive integer`);
        }
      }
      return sortedCounts(value as Counts);
    }
    case "per-group-file": {
      if (!isRecord(value)) {
        throw invalid("expected { group: { file: count } }");
      }
      const counts: Counts = {};
      for (const [group, files] of Object.entries(value)) {
        if (!isRecord(files)) {
          throw invalid(`entry for ${group} must be an object`);
        }
        for (const [file, count] of Object.entries(files)) {
          if (!isPositiveInteger(count)) {
            throw invalid(
              `count for ${group} ${file} must be a positive integer`,
            );
          }
          counts[`${group} ${file}`] = count;
        }
      }
      return sortedCounts(counts);
    }
  }
}

/** The stored form of `counts`: a bare integer or pretty JSON. */
export function serializeBaseline(kind: BaselineKind, counts: Counts): string {
  switch (kind) {
    case "zero":
      return "0";
    case "total":
      return String(counts[TOTAL_KEY] ?? 0);
    case "per-file":
      return JSON.stringify(sortedCounts(counts), null, 2);
    case "per-group-file": {
      const nested: Record<string, Counts> = {};
      for (const [key, count] of Object.entries(counts)) {
        const split = key.indexOf(" ");
        const group = key.slice(0, split);
        const file = key.slice(split + 1);
        (nested[group] ??= {})[file] = count;
      }
      const sorted: Record<string, Counts> = {};
      for (const group of Object.keys(nested).sort()) {
        sorted[group] = sortedCounts(nested[group] ?? {});
      }
      return JSON.stringify(sorted, null, 2);
    }
  }
}

/**
 * Rewrite `export const NAME = <int>;` in a module's source. Returns the new
 * text, or throws when the declaration is not found exactly once — in which
 * case the caller falls back to telling the user what to edit.
 */
export function rewriteInlineConstant(
  source: string,
  constant: string,
  value: number,
): string {
  const pattern = new RegExp(`^(export const ${constant} = )\\d+(;)$`, "gm");
  const matches = source.match(pattern) ?? [];
  if (matches.length !== 1) {
    throw new Error(
      `expected exactly one \`export const ${constant} = <n>;\` line, found ${matches.length}`,
    );
  }
  return source.replace(pattern, `$1${value}$2`);
}

// ---------------------------------------------------------------------------
// Running a ratchet
// ---------------------------------------------------------------------------

export interface RatchetSpec {
  /** Plural noun phrase used in every report line, e.g. `Sanitizer opt-outs`. */
  label: string;
  /** The `deno task` name, for lock-in hints. */
  task: string;
  scope: ScanScope;
  select: (relative: string) => boolean;
  /** The matcher. May throw `ParseFailure`; any other error aborts the run. */
  scan: (source: string, file: string) => Finding[];
  baseline: BaselineStore;
  /** What to do instead, printed after a regression. */
  advice: string;
  /** Heading for `blocking` findings; defaults to a generic one. */
  blockingTitle?: string;
}

export interface RunOptions {
  args?: readonly string[];
  repoRoot?: string;
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
}

const FLAGS = new Set(["--print-baseline", "--update", "--list"]);

function formatFinding(finding: Finding): string {
  return `  ${finding.file}:${finding.line}  ${finding.message}`;
}

function formatDelta(delta: CountDelta): string {
  return `  ${delta.key}: ${delta.then} -> ${delta.now}`;
}

function baselineLocation(store: BaselineStore, repoRoot: string): string {
  switch (store.kind) {
    case "zero":
      return "";
    case "total":
      return toRepoRelative(fromFileUrl(store.module), repoRoot);
    case "per-file":
    case "per-group-file":
      return store.path;
  }
}

/**
 * Run `spec` end to end and return the process exit code. Scripts call
 * `Deno.exit(await runRatchet(spec))`; tests pass a temp `repoRoot` and
 * capture output through `stdout` / `stderr`.
 */
export async function runRatchet(
  spec: RatchetSpec,
  options: RunOptions = {},
): Promise<number> {
  const args = options.args ?? Deno.args;
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  const out = options.stdout ?? ((line) => console.log(line));
  const err = options.stderr ?? ((line) => console.error(line));
  const { kind } = spec.baseline;
  const location = baselineLocation(spec.baseline, repoRoot);

  const unknown = args.filter((arg) => !FLAGS.has(arg));
  if (unknown.length > 0) {
    err(
      `Unknown argument(s): ${unknown.join(" ")}. Flags: ${
        [...FLAGS].join(", ")
      }.`,
    );
    return 2;
  }

  let files: ScannedFile[];
  try {
    files = await walkRepo({
      scope: spec.scope,
      select: spec.select,
      repoRoot,
    });
  } catch (error) {
    if (error instanceof MissingScanRoot) {
      err(`${spec.label}: ${error.message}`);
      return 2;
    }
    throw error;
  }

  const findings: Finding[] = [];
  const parseFailures: string[] = [];
  for (const file of files) {
    const source = await Deno.readTextFile(file.path);
    try {
      findings.push(...spec.scan(source, file.relative));
    } catch (error) {
      if (error instanceof ParseFailure) parseFailures.push(error.message);
      else throw error;
    }
  }
  const sorted = sortFindings(findings);
  const blocking = sorted.filter((finding) => finding.blocking === true);
  const baselined = sorted.filter((finding) => finding.blocking !== true);
  const current = countFindings(baselined, kind);

  if (args.includes("--list")) {
    for (const finding of sorted) out(formatFinding(finding).trimStart());
  }

  if (args.includes("--print-baseline") || args.includes("--update")) {
    if (kind === "zero") {
      err(
        `${spec.label}: this check allows nothing, so it has no baseline to print or update.`,
      );
      return 2;
    }
    if (parseFailures.length > 0) {
      err(
        `${spec.label}: refusing to produce a baseline while files cannot be parsed:`,
      );
      for (const failure of parseFailures) err(`  ${failure}`);
      return 1;
    }
    if (blocking.length > 0) {
      err(
        `${spec.label}: refusing to produce a baseline while blocking findings ` +
          `exist — they are never baselined, so the check would still fail:`,
      );
      for (const finding of blocking) err(formatFinding(finding));
      return 1;
    }
    const serialized = serializeBaseline(kind, current);
    if (args.includes("--print-baseline")) {
      out(serialized);
      return 0;
    }
    return await writeBaseline(spec, current, serialized, {
      repoRoot,
      out,
      err,
    });
  }

  let baseline: Counts;
  try {
    baseline = await loadBaseline(spec.baseline, repoRoot);
  } catch (error) {
    err(
      `${spec.label}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return 2;
  }
  const { regressions, improvements } = compareCounts(current, baseline);

  if (parseFailures.length > 0) {
    err(`\n${spec.label}: files that could not be parsed:`);
    for (const failure of parseFailures) err(`  ${failure}`);
  }
  if (blocking.length > 0) {
    err(`\n${spec.blockingTitle ?? `${spec.label} that are never allowed:`}`);
    for (const finding of blocking) err(formatFinding(finding));
  }
  if (regressions.length > 0) {
    if (kind === "zero") {
      err(`\n${spec.label}: ${baselined.length} found (none allowed):`);
      for (const finding of baselined) err(formatFinding(finding));
    } else if (kind === "total") {
      const [delta] = regressions;
      err(`\n${spec.label} ${delta?.now} exceed baseline ${delta?.then}:`);
      for (const finding of baselined) err(formatFinding(finding));
    } else {
      err(`\n${spec.label} above the baseline:`);
      for (const delta of regressions) err(formatDelta(delta));
      const regressed = new Set(regressions.map((delta) => delta.key));
      err(`\nCurrent findings under the regressed key(s):`);
      for (const finding of baselined) {
        if (regressed.has(keyOf(finding, kind))) err(formatFinding(finding));
      }
    }
  }

  if (
    parseFailures.length > 0 || blocking.length > 0 || regressions.length > 0
  ) {
    err(`\n${spec.advice}`);
    if (kind !== "zero") {
      err(`Do not raise ${location} for new violations.`);
    }
    return 1;
  }

  if (improvements.length > 0) {
    out(`${spec.label} debt decreased:`);
    for (const delta of improvements) out(formatDelta(delta));
    if (spec.baseline.kind === "total") {
      out(
        `Lower ${spec.baseline.constant} to ${
          current[TOTAL_KEY] ?? 0
        } in ${location} ` +
          `to lock it in (\`deno task ${spec.task}:update\` does it for you).`,
      );
    } else {
      out(
        `Regenerate ${location} with \`deno task ${spec.task}:update\` to lock in the improvement.`,
      );
    }
    return 0;
  }

  switch (kind) {
    case "zero":
      out(`${spec.label}: none found.`);
      break;
    case "total":
      out(
        `${spec.label} baseline ok: ${baselined.length}/${
          baseline[TOTAL_KEY] ?? 0
        }.`,
      );
      break;
    default: {
      const fileCount = new Set(baselined.map((finding) => finding.file)).size;
      out(
        `${spec.label} baseline ok: ${baselined.length} baselined across ${fileCount} file(s).`,
      );
    }
  }
  return 0;
}

async function loadBaseline(
  store: BaselineStore,
  repoRoot: string,
): Promise<Counts> {
  switch (store.kind) {
    case "zero":
      return {};
    case "total":
      return parseBaseline("total", store.value, store.constant);
    case "per-file":
    case "per-group-file": {
      let text: string;
      try {
        text = await Deno.readTextFile(`${repoRoot}${store.path}`);
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) {
          throw new Error(
            `baseline file ${store.path} is missing — run with --update to create it.`,
          );
        }
        throw error;
      }
      return parseBaseline(store.kind, JSON.parse(text), store.path);
    }
  }
}

async function writeBaseline(
  spec: RatchetSpec,
  current: Counts,
  serialized: string,
  io: {
    repoRoot: string;
    out: RunOptions["stdout"];
    err: RunOptions["stderr"];
  },
): Promise<number> {
  const { repoRoot } = io;
  const out = io.out ?? (() => {});
  const err = io.err ?? (() => {});
  const store = spec.baseline;
  const location = baselineLocation(store, repoRoot);
  let previous: Counts = {};
  try {
    previous = await loadBaseline(store, repoRoot);
  } catch {
    // A missing or malformed baseline is exactly what --update repairs.
  }
  const { regressions } = compareCounts(current, previous);

  if (store.kind === "total") {
    const modulePath = fromFileUrl(store.module);
    const source = await Deno.readTextFile(modulePath);
    let rewritten: string;
    try {
      rewritten = rewriteInlineConstant(
        source,
        store.constant,
        current[TOTAL_KEY] ?? 0,
      );
    } catch (error) {
      err(
        `${spec.label}: could not rewrite ${location} (${
          error instanceof Error ? error.message : String(error)
        }). Set ${store.constant} to ${serialized} by hand.`,
      );
      return 2;
    }
    if (rewritten !== source) await Deno.writeTextFile(modulePath, rewritten);
    out(`${spec.label}: set ${store.constant} = ${serialized} in ${location}.`);
  } else if (store.kind === "per-file" || store.kind === "per-group-file") {
    await Deno.writeTextFile(`${repoRoot}${store.path}`, `${serialized}\n`);
    out(
      `${spec.label}: wrote ${location} (${
        Object.keys(current).length
      } key(s)).`,
    );
  }

  if (regressions.length > 0) {
    err(
      `Warning: ${regressions.length} key(s) were raised — a baseline should only go down:`,
    );
    for (const delta of regressions) err(formatDelta(delta));
  }
  return 0;
}

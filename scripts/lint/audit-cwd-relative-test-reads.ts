#!/usr/bin/env -S deno run --allow-read
/**
 * Bans cwd-relative repo reads in test files.
 *
 * Test files run as separate isolates inside ONE process under `--parallel`,
 * and `src/testing/cwd.ts` calls `Deno.chdir` on that shared process — its own
 * header says so: "mutates state shared by every test in the process". It
 * restores in a `finally`, but a restore only closes the window afterwards; a
 * reader executing inside the window still resolves against another test's
 * directory.
 *
 * Which test files share a process is decided by the suite planner's ordinal
 * shard selection (`index % 8` over the sorted file list), so adding any test
 * file anywhere reshuffles the pairings. A test that reads a
 * repo file by cwd-relative path is therefore not stably correct — it is
 * correct until an unrelated file lands beside it.
 *
 * The fix is to resolve from `import.meta.url` instead of the process cwd:
 *
 *   const repoRoot = new URL("../../", import.meta.url);
 *   await Deno.readTextFile(new URL("deno.json", repoRoot));
 *
 * That removes the dependency rather than trying to coordinate chdir discipline
 * across every test in the process, which `--parallel` makes impossible anyway.
 *
 * ## Two tiers, because the blast radius differs
 *
 * The race does not care where in a file the read sits: a sibling isolate can
 * hold `withCwd` while *this* file's `it(...)` callback is running, so a
 * cwd-relative read inside a test body is racy too. What differs is how the
 * failure is reported.
 *
 *  - MODULE SCOPE — hard failure, zero allowed. A top-level `await` that throws
 *    is an *uncaught module error*: Deno fails the whole file, so the shard
 *    fails and every job that needs it (`tests (unit)`, `coverage gate`) fails
 *    as a dependent. One unreadable file, three red checks, no useful message.
 *    That is exactly what `src/config/cicd-coverage-workflow.test.ts` did,
 *    three times, on different shards.
 *
 *  - CALLBACK SCOPE — baseline ratchet. Same race, but the throw is one legible
 *    failing test. The repo already has a pile of these, so they are frozen in
 *    `cwd-relative-test-reads-baseline.json` as a per-file count that may only
 *    shrink. Per-file counts, not just the file set: adding a second racy read
 *    to an already-listed file must fail, or the ratchet leaks.
 *
 * ## Why a real parser
 *
 * The first version of this audit matched a regex per line and tracked
 * delimiter depth. That cannot work. `Deno.readTextFile(\n  "deno.json",\n)` is
 * ordinary `deno fmt` output and the path never shares a line with the call;
 * a read in a top-level object initializer sits at depth > 0 but still runs at
 * module eval; and an inline `Deno.test("x", () => { read })` was flagged
 * because the match ran before the line's depth was updated. Execution scope is
 * a syntactic property, so it is read off the syntax: `@babel/parser`, already
 * used by `scripts/codemods/`, with a walk that tracks whether the call is
 * inside a function body.
 */

import { parse } from "npm:@babel/parser@7.29.2";
import { fromFileUrl } from "#std/path";

/** Filesystem reads whose first argument resolves against the process cwd. */
const READ_METHODS = new Set([
  "readTextFile",
  "readTextFileSync",
  "readFile",
  "readFileSync",
  "readDir",
  "readDirSync",
  "stat",
  "statSync",
  "lstat",
  "lstatSync",
]);

/**
 * The runtime-neutral reader has the same hazard as the `Deno.*` one.
 *
 * `#veryfront/platform/compat/fs.ts` forwards to the host runtime, so a
 * cwd-relative string passed to it races identically. Tests under `src/` are
 * pushed towards this module (the `Deno.*` global is excluded from the Node and
 * Bun runners), so leaving it unwatched would open a hole exactly where the
 * guidance sends people. Matched by import binding rather than by name, so a
 * local helper that happens to be called `readTextFile` is not touched.
 */
const COMPAT_FS_SPECIFIERS = [
  "#veryfront/platform/compat/fs.ts",
  "platform/compat/fs.ts",
];

/** Where a read executes, which decides how loudly the race fails. */
export type ReadScope = "module" | "callback";

export interface CwdRelativeRead {
  file: string;
  line: number;
  /** Source spelling of the callee, e.g. `Deno.readTextFile`. */
  call: string;
  path: string;
  scope: ReadScope;
}

/** A path that resolves against the process cwd rather than the module. */
export function isCwdRelative(path: string): boolean {
  if (path.startsWith("file:") || path.startsWith("http")) return false;
  if (path.startsWith("/")) return false;
  return true;
}

interface Node {
  type: string;
  loc?: { start: { line: number } };
  [key: string]: unknown;
}

const FUNCTION_TYPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "ObjectMethod",
  "ClassMethod",
  "ClassPrivateMethod",
]);

/**
 * Attached comments carry a `type` too, so the walk would descend into them.
 * They can never contain a call, but a read spelled inside a comment must not
 * be reported, and skipping them makes that structural rather than incidental.
 */
const COMMENT_KEYS = new Set([
  "leadingComments",
  "trailingComments",
  "innerComments",
  "comments",
]);

function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null &&
    typeof (value as { type?: unknown }).type === "string";
}

function isIdentifier(value: unknown, name: string): boolean {
  return isNode(value) && value.type === "Identifier" && value.name === name;
}

function memberProperty(node: Node): string | undefined {
  const property = node.property;
  if (!isNode(property) || node.computed === true) return undefined;
  return property.type === "Identifier" ? property.name as string : undefined;
}

function isCompatFsSpecifier(source: string): boolean {
  return COMPAT_FS_SPECIFIERS.some((specifier) => source.endsWith(specifier));
}

/**
 * Named and namespace bindings that reach the compat filesystem module.
 *
 * Returns the local names of imported read functions plus the local names of
 * namespace imports, so both `readTextFile(p)` and `fs.readTextFile(p)` are
 * recognised without guessing at identifiers that were never imported.
 */
function collectCompatFsBindings(
  program: Node,
): { direct: Set<string>; namespaces: Set<string> } {
  const direct = new Set<string>();
  const namespaces = new Set<string>();
  const body = Array.isArray(program.body) ? program.body : [];

  for (const statement of body) {
    if (!isNode(statement) || statement.type !== "ImportDeclaration") continue;
    const source = statement.source;
    if (!isNode(source) || typeof source.value !== "string") continue;
    if (!isCompatFsSpecifier(source.value)) continue;

    const specifiers = Array.isArray(statement.specifiers)
      ? statement.specifiers
      : [];
    for (const specifier of specifiers) {
      if (!isNode(specifier)) continue;
      const local = isNode(specifier.local)
        ? specifier.local.name as string
        : undefined;
      if (local === undefined) continue;
      if (specifier.type === "ImportNamespaceSpecifier") {
        namespaces.add(local);
        continue;
      }
      const imported = specifier.imported;
      const importedName = isNode(imported) && imported.type === "Identifier"
        ? imported.name as string
        : undefined;
      if (importedName !== undefined && READ_METHODS.has(importedName)) {
        direct.add(local);
      }
    }
  }

  return { direct, namespaces };
}

/** The callee spelling if this call is a watched filesystem read. */
function readCallName(
  node: Node,
  bindings: { direct: Set<string>; namespaces: Set<string> },
): string | undefined {
  const callee = node.callee;
  if (!isNode(callee)) return undefined;

  if (callee.type === "Identifier") {
    const name = callee.name as string;
    return bindings.direct.has(name) ? name : undefined;
  }

  if (callee.type !== "MemberExpression") return undefined;
  const method = memberProperty(callee);
  if (method === undefined || !READ_METHODS.has(method)) return undefined;

  if (isIdentifier(callee.object, "Deno")) return `Deno.${method}`;
  if (
    isNode(callee.object) && callee.object.type === "Identifier" &&
    bindings.namespaces.has(callee.object.name as string)
  ) {
    return `${callee.object.name}.${method}`;
  }
  return undefined;
}

/** The literal path of a read call, if the argument is a static string. */
function staticPathArgument(node: Node): string | undefined {
  const args = Array.isArray(node.arguments) ? node.arguments : [];
  const first = args[0];
  if (!isNode(first)) return undefined;
  if (first.type === "StringLiteral") return first.value as string;
  if (first.type === "TemplateLiteral") {
    const expressions = Array.isArray(first.expressions)
      ? first.expressions
      : [];
    const quasis = Array.isArray(first.quasis) ? first.quasis : [];
    if (expressions.length > 0 || quasis.length !== 1) return undefined;
    const cooked = isNode(quasis[0])
      ? (quasis[0].value as { cooked?: string }).cooked
      : undefined;
    return cooked;
  }
  return undefined;
}

/** Raised when a test file cannot be parsed, so the audit fails closed. */
export class ParseFailure extends Error {}

/**
 * Report every cwd-relative filesystem read in `source`, tagged with its scope.
 *
 * A read is `callback` scope when it sits inside a function body that runs
 * later; everything that runs during module evaluation — top-level object
 * initializers, class static blocks, `await`ed module statements, and the body
 * of a directly invoked function expression — is `module` scope, whatever its
 * nesting depth.
 *
 * The one case this under-reports is a function *declared* at module scope and
 * *called* at module scope through a binding, which is reported as `callback`.
 * That errs towards the baselined tier rather than the hard-failure one, and
 * the baseline holds a per-file count, so it cannot grow silently either way.
 */
export function findCwdRelativeReads(
  source: string,
  file: string,
): CwdRelativeRead[] {
  let ast;
  try {
    ast = parse(source, {
      sourceType: "module",
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: true,
      errorRecovery: false,
      plugins: ["typescript", "jsx", "decorators-legacy", "importAttributes"],
    });
  } catch (error) {
    throw new ParseFailure(
      `${file}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const program = ast.program as unknown as Node;
  const bindings = collectCompatFsBindings(program);
  const reads: CwdRelativeRead[] = [];

  /**
   * `invokedHere` marks a function node that is the callee of the call it sits
   * in — an IIFE. Its body runs during the enclosing evaluation rather than
   * later, so it must not open a callback boundary; otherwise a top-level
   * `(async () => { read })()` would be filed under the baseline tier while
   * still being able to throw an uncaught module error.
   */
  const visit = (
    node: Node,
    inFunction: boolean,
    invokedHere = false,
  ): void => {
    if (node.type === "CallExpression") {
      const call = readCallName(node, bindings);
      const path = call === undefined ? undefined : staticPathArgument(node);
      if (call !== undefined && path !== undefined && isCwdRelative(path)) {
        reads.push({
          file,
          line: node.loc?.start.line ?? 0,
          call,
          path,
          scope: inFunction ? "callback" : "module",
        });
      }
    }

    const opensCallback = FUNCTION_TYPES.has(node.type) && !invokedHere;
    const nested = inFunction || opensCallback;
    for (const key of Object.keys(node)) {
      if (key === "loc" || COMMENT_KEYS.has(key)) continue;
      const value = node[key];
      const immediate = node.type === "CallExpression" && key === "callee";
      if (Array.isArray(value)) {
        for (const item of value) if (isNode(item)) visit(item, nested);
      } else if (isNode(value)) {
        visit(value, nested, immediate);
      }
    }
  };

  visit(program, false);
  return reads.sort((a, b) => a.line - b.line);
}

/** Per-file counts of callback-scope reads, the shape stored in the baseline. */
export type CallbackBaseline = Record<string, number>;

export function callbackCountsByFile(
  reads: readonly CwdRelativeRead[],
): CallbackBaseline {
  const counts: CallbackBaseline = {};
  for (const read of reads) {
    if (read.scope !== "callback") continue;
    counts[read.file] = (counts[read.file] ?? 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)),
  );
}

export interface BaselineComparison {
  /** Files whose count grew (or appeared). The ratchet slipping backwards. */
  regressions: string[];
  /** Files whose count shrank (or vanished). The ratchet earning a new floor. */
  improvements: string[];
}

/**
 * Compare current callback-scope counts with the frozen baseline.
 *
 * Counts are compared per file, not just membership: a file already carrying
 * two racy reads must not quietly grow a third.
 */
export function compareCallbackBaseline(
  current: CallbackBaseline,
  baseline: CallbackBaseline,
): BaselineComparison {
  const regressions: string[] = [];
  const improvements: string[] = [];

  for (
    const file of new Set([...Object.keys(current), ...Object.keys(baseline)])
  ) {
    const now = current[file] ?? 0;
    const then = baseline[file] ?? 0;
    if (now > then) regressions.push(`${file}: ${then} -> ${now}`);
    else if (now < then) improvements.push(`${file}: ${then} -> ${now}`);
  }

  return { regressions: regressions.sort(), improvements: improvements.sort() };
}

export function parseBaseline(value: unknown, path: string): CallbackBaseline {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Invalid cwd-relative read baseline: ${path}`);
  }
  const entries = Object.entries(value as Record<string, unknown>);
  for (const [file, count] of entries) {
    if (typeof count !== "number" || !Number.isInteger(count) || count < 1) {
      throw new Error(
        `Invalid cwd-relative read baseline entry for ${file}: ${count}`,
      );
    }
  }
  return Object.fromEntries(entries) as CallbackBaseline;
}

/**
 * Baseline key for a scanned file: repo-relative, always posix separators.
 *
 * The baseline is committed and compared by key, so a Windows checkout has to
 * produce the same keys a Linux one does.
 */
export function toRepoRelative(file: string, repoRoot: string): string {
  return file.slice(repoRoot.length).replaceAll("\\", "/");
}

const BASELINE_PATH = "scripts/lint/cwd-relative-test-reads-baseline.json";
const SCAN_ROOTS = ["src", "cli", "templates", "tests", "scripts"] as const;

async function collectTestFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  let entries: AsyncIterable<Deno.DirEntry>;
  try {
    entries = Deno.readDir(root);
  } catch {
    return files; // expected: a scan root may not exist in every checkout
  }
  for await (const entry of entries) {
    const path = `${root}/${entry.name}`;
    if (entry.isDirectory) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      files.push(...await collectTestFiles(path));
    } else if (
      entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.tsx")
    ) {
      files.push(path);
    }
  }
  return files;
}

function printFindings(title: string, findings: readonly string[]): void {
  if (findings.length === 0) return;
  console.error(`\n${title}`);
  for (const finding of findings) console.error(`  ${finding}`);
}

async function main(): Promise<void> {
  // `fromFileUrl`, not `URL.pathname`: pathname keeps the URL's leading slash
  // and percent encoding, so a Windows checkout would scan `/C:/...` and find
  // nothing.
  const repoRoot = fromFileUrl(new URL("../../", import.meta.url));
  const reads: CwdRelativeRead[] = [];
  const parseFailures: string[] = [];

  for (const root of SCAN_ROOTS) {
    for (const file of await collectTestFiles(`${repoRoot}${root}`)) {
      const relative = toRepoRelative(file, repoRoot);
      const source = await Deno.readTextFile(file);
      try {
        reads.push(...findCwdRelativeReads(source, relative));
      } catch (error) {
        parseFailures.push(
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  }

  const current = callbackCountsByFile(reads);
  if (Deno.args.includes("--print-baseline")) {
    console.log(JSON.stringify(current, null, 2));
    return;
  }

  const baseline = parseBaseline(
    JSON.parse(await Deno.readTextFile(`${repoRoot}${BASELINE_PATH}`)),
    BASELINE_PATH,
  );
  const moduleScope = reads.filter((read) => read.scope === "module");
  const { regressions, improvements } = compareCallbackBaseline(
    current,
    baseline,
  );

  printFindings("Test files that could not be parsed:", parseFailures);
  printFindings(
    "Cwd-relative repo reads at test MODULE scope (never allowed — an uncaught " +
      "module error fails the whole shard):",
    moduleScope.map((read) =>
      `${read.file}:${read.line}  ${read.call}("${read.path}")`
    ),
  );
  printFindings(
    "Test files with MORE cwd-relative reads inside test callbacks than the baseline:",
    regressions,
  );

  if (
    parseFailures.length > 0 || moduleScope.length > 0 || regressions.length > 0
  ) {
    console.error(
      `\nResolve the path from import.meta.url instead of the process cwd — see the ` +
        `header of this script for why. Do not raise ${BASELINE_PATH} for new violations.`,
    );
    Deno.exit(1);
  }

  if (improvements.length > 0) {
    printFindings("Cwd-relative read debt decreased:", improvements);
    console.log(
      `\nRegenerate ${BASELINE_PATH} with ` +
        `\`deno task lint:cwd-relative-test-reads -- --print-baseline\` to lock in the improvement.`,
    );
    return;
  }

  const total = Object.values(current).reduce((sum, count) => sum + count, 0);
  console.log(
    `Cwd-relative test reads ok: 0 at module scope, ` +
      `${total} baselined inside test callbacks across ${
        Object.keys(current).length
      } file(s).`,
  );
}

if (import.meta.main) {
  await main();
}

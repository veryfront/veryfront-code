#!/usr/bin/env -S deno run --allow-read
/**
 * Cross-runtime resolvability audit for `@std` / `jsr:` imports.
 *
 * Deno is the primary runtime, but `src/` is also executed by the Node and Bun
 * test runners (`deno task test:node`, `deno task test:bun`). Neither of those
 * runtimes understands JSR. They only work because a std specifier is rewritten
 * to a LOCAL compat shim under `src/platform/compat/std/`, and each runtime
 * does that rewriting through a DIFFERENT config file:
 *
 *   - Node reads `deno.json` `imports` through `tests/node/resolver-hooks.mjs`,
 *     which maps a `jsr:@std/...` target onto the compat shim.
 *   - Bun reads `tsconfig.json` `compilerOptions.paths`. Verified by
 *     experiment: Bun never consults the `tests/bun/preload.ts` `onResolve`
 *     plugin for a `#std/...` or `@std/...` specifier (instrumenting the plugin
 *     logs zero hits for them), and adding a local mapping to `deno.json`
 *     alone does not make Bun resolve it, while adding the same mapping to
 *     `tsconfig.json` `paths` does.
 *
 * So a std specifier is only safe when it is shimmed in BOTH places. Getting
 * one of the two right produces a green Deno run, a green lint, a green
 * typecheck, and a failing Node or Bun suite much later, reported as an
 * unrelated-looking test-file error. This audit moves that failure to the
 * moment the import is written.
 *
 * Two rules:
 *
 * 1. HARD: a cross-runtime file may never import a `jsr:` specifier directly.
 *    Bun has no `jsr:` protocol; `tsconfig.json` `paths` has no `jsr:` key; and
 *    the alias plugin in `tests/bun/preload.ts` filters on
 *    `/^(#deno-config|@std\/|#std\/|std\/|#veryfront...)/`, which cannot match
 *    a `jsr:` specifier. Node happens to cope because `resolveJsrStdSpecifier` in
 *    resolver-hooks.mjs intercepts `jsr:@std/*`. This is exactly why "the
 *    equivalent `#std/` alias is shimmed" and "it resolves on Node" are both
 *    worthless as exemptions. Import the `#std/...` alias instead.
 *
 * 2. RATCHET: a std specifier that is not shimmed on both runtimes is recorded
 *    in `UNSHIMMED_STD_BASELINE` with the number of cross-runtime files that
 *    depend on it. Both the set of such specifiers and the per-specifier
 *    dependent count may only shrink. Gating the dependent count and not just
 *    the specifier set is the point: adding a new file that imports an
 *    already-baselined broken specifier adds a new broken Node/Bun test, and a
 *    set-only ratchet would stay green through it.
 *
 * Requiring both runtimes is what keeps "shimmed" honest. The two resolvers
 * are not equivalent. Node retries the lookup with a `.ts` suffix and falls
 * back to a `./src/platform/compat/std/<subpath>.ts` convention, so dropping a
 * shim file in is enough for Node; Bun does neither and needs an exact
 * `tsconfig.json` `paths` key. This audit holds to the stricter of the two.
 */

import {
  flattenTsconfigPaths,
  resolveTsconfigPath,
} from "#veryfront/config/tsconfig-paths.ts";
import { extractImports } from "./check-module-boundaries.ts";

export { flattenTsconfigPaths, resolveTsconfigPath };

/**
 * Roots that Node and Bun execute. Mirrors the runner globs: `test:node` runs
 * `src/**\/*.test.ts` and `test:bun` runs `src/`. Extensions are Deno-only.
 */
export const CROSS_RUNTIME_ROOTS = ["src"] as const;

/**
 * Std specifiers that still bottom out in JSR, mapped to the number of
 * cross-runtime files importing them at runtime. Every entry is a Node/Bun
 * breakage waiting to be triggered.
 *
 * Only ever lower these numbers by shimming the specifier (a file under
 * `src/platform/compat/std/`, a local `deno.json` "imports" entry, AND a
 * matching `tsconfig.json` "paths" entry), or by dropping the import. The lint
 * prints the exact edit when a number moves.
 */
export const UNSHIMMED_STD_BASELINE: Readonly<Record<string, number>> = {
  "#std/fs/walk": 1,
  "#std/testing/mock": 2,
  "@std/fs/walk": 1,
};

const NODE_RESOLVER_PATH = "tests/node/resolver-hooks.mjs";
const BUN_PRELOAD_PATH = "tests/bun/preload.ts";
const DENO_CONFIG_PATH = "deno.json";
const TSCONFIG_PATH = "tsconfig.json";

/** Node's `findActualFile` candidate list (resolver-hooks.mjs). */
const NODE_FILE_SUFFIXES = ["", ".ts", ".tsx", ".js", ".mjs", ".cjs", ".json"];
const NODE_INDEX_FILES = [
  "index.ts",
  "index.tsx",
  "index.js",
  "index.mjs",
  "index.cjs",
];

/** Bun resolves `paths` targets to concrete files; no index/extension search. */
const BUN_FILE_SUFFIXES = ["", ".ts", ".tsx", ".js", ".mjs", ".json"];
const BUN_INDEX_FILES = ["index.ts", "index.tsx", "index.js", "index.mjs"];

export interface RuntimeResolutionContext {
  /** deno.json `imports`, string values only. Node's alias source. */
  readonly imports: Readonly<Record<string, string>>;
  /** `stdImportMap` literal from `tests/node/resolver-hooks.mjs`. */
  readonly nodeStdShims: Readonly<Record<string, string>>;
  /** tsconfig.json `compilerOptions.paths`, flattened to one target. Bun's source. */
  readonly tsconfigPaths: Readonly<Record<string, string>>;
  /** Does this repo-relative path exist as a file? */
  readonly fileExists: (path: string) => boolean;
}

export interface CrossRuntimeImport {
  readonly file: string;
  readonly line: number;
  readonly specifier: string;
}

export interface CrossRuntimeAudit {
  /** Direct `jsr:` imports are unresolvable on Bun, with no exemption. */
  readonly directJsrImports: readonly CrossRuntimeImport[];
  /** Unshimmed std specifier -> sorted unique files importing it. */
  readonly unshimmedDependents: ReadonlyMap<string, readonly string[]>;
}

export interface GrownEntry {
  readonly specifier: string;
  readonly baseline: number;
  readonly current: number;
  readonly files: readonly string[];
}

export interface ShrunkEntry {
  readonly specifier: string;
  readonly baseline: number;
  readonly current: number;
}

export interface BaselineComparison {
  /** Unshimmed specifiers with no baseline entry at all. */
  readonly newSpecifiers: readonly GrownEntry[];
  /** Baselined specifiers that gained dependents. */
  readonly grown: readonly GrownEntry[];
  /** Baselined specifiers that lost dependents but still have some. */
  readonly shrunk: readonly ShrunkEntry[];
  /** Baselined specifiers that now resolve on BOTH runtimes because a shim landed. */
  readonly staleShimmed: readonly string[];
  /** Baselined specifiers still unshimmed but no longer imported anywhere. */
  readonly staleUnused: readonly string[];
}

/**
 * `@std/x` and `std/x` both address the `#std/x` alias namespace. Mirrors
 * `normalizeStdSpecifier` in `tests/node/resolver-hooks.mjs`. Bun has no
 * equivalent, which is why `resolvesOnBun` does not call this.
 */
export function normalizeStdSpecifier(specifier: string): string {
  if (specifier.startsWith("@std/")) {
    return `#std/${specifier.slice("@std/".length)}`;
  }
  if (specifier.startsWith("std/")) {
    return `#std/${specifier.slice("std/".length)}`;
  }
  return specifier;
}

/** Is this specifier in scope for the audit at all? */
export function isStdOrJsrSpecifier(specifier: string): boolean {
  return specifier.startsWith("jsr:") ||
    specifier.startsWith("@std/") ||
    specifier.startsWith("#std/") ||
    specifier.startsWith("std/");
}

function stripLeadingDotSlash(path: string): string {
  return path.replace(/^\.\//, "");
}

function existsWithCandidates(
  target: string,
  suffixes: readonly string[],
  indexFiles: readonly string[],
  fileExists: (path: string) => boolean,
): boolean {
  const base = stripLeadingDotSlash(target);
  for (const suffix of suffixes) {
    if (fileExists(`${base}${suffix}`)) return true;
  }
  return indexFiles.some((index) => fileExists(`${base}/${index}`));
}

/**
 * Extract the `stdImportMap = { ... }` object literal from the Node resolver.
 * Reading it instead of duplicating it means this audit cannot silently
 * disagree with the resolver it is modelling.
 */
export function parseStdShimMap(source: string): Record<string, string> {
  const block = /const stdImportMap[^=]*=\s*\{([\s\S]*?)\n\};/.exec(source);
  if (!block) return {};
  const entries: Record<string, string> = {};
  for (const match of block[1].matchAll(/"([^"]+)"\s*:\s*"([^"]+)"/g)) {
    entries[match[1]] = match[2];
  }
  return entries;
}

/** Mirrors `resolveFromImportMap` in `tests/node/resolver-hooks.mjs`. */
function nodeResolveFromImportMap(
  imports: Readonly<Record<string, string>>,
  specifier: string,
): string | null {
  const direct = imports[specifier];
  if (direct) return direct;

  for (const [prefix, target] of Object.entries(imports)) {
    if (!prefix.endsWith("/*") || !specifier.startsWith(prefix.slice(0, -1))) {
      continue;
    }
    let suffix = specifier.slice(prefix.length - 1);
    if (target.endsWith("*.ts") && suffix.endsWith(".ts")) {
      suffix = suffix.slice(0, -3);
    }
    return target.replaceAll("*", suffix);
  }

  for (const [prefix, target] of Object.entries(imports)) {
    if (
      prefix.endsWith("/") && !prefix.endsWith("/*") &&
      specifier.startsWith(prefix)
    ) {
      return target + specifier.slice(prefix.length);
    }
  }

  return null;
}

/**
 * Mirrors `resolveStdCompatTarget`. Note the two Node-only leniencies: the
 * `.ts`-suffixed retry and the `./src/platform/compat/std/<subpath>.ts`
 * convention. Bun has neither.
 */
function nodeStdCompatTarget(
  shims: Readonly<Record<string, string>>,
  specifier: string,
): string | null {
  const normalized = normalizeStdSpecifier(specifier);
  if (shims[normalized]) return shims[normalized];
  if (shims[`${normalized}.ts`]) return shims[`${normalized}.ts`];
  if (normalized.startsWith("#std/")) {
    return `./src/platform/compat/std/${normalized.slice("#std/".length)}.ts`;
  }
  return null;
}

/** Would `tests/node/resolver-hooks.mjs` resolve this specifier to a file? */
export function resolvesOnNode(
  specifier: string,
  context: RuntimeResolutionContext,
): boolean {
  const findFile = (target: string) =>
    existsWithCandidates(
      target,
      NODE_FILE_SUFFIXES,
      NODE_INDEX_FILES,
      context.fileExists,
    );

  // `resolveJsrStdSpecifier` runs first and rewrites `jsr:@std/x@1/sub` to the
  // compat shim. This is the leniency that made the previous rule unsound.
  if (specifier.startsWith("jsr:@std/")) {
    const subpath = specifier.slice("jsr:@std/".length).replace(/@[^/]+/, "");
    const target = nodeStdCompatTarget(
      context.nodeStdShims,
      `#std/${subpath}`,
    );
    return target !== null && findFile(target);
  }
  if (specifier.startsWith("jsr:")) return false;

  const normalized = normalizeStdSpecifier(specifier);
  const mapped = nodeResolveFromImportMap(context.imports, specifier) ??
    nodeResolveFromImportMap(context.imports, normalized);
  const fallback = context.nodeStdShims[specifier] ??
    context.nodeStdShims[normalized];
  const target = mapped ?? fallback;
  if (!target) return false;

  if (target.startsWith("./") || target.startsWith("../")) {
    return findFile(target);
  }
  if (target.startsWith("jsr:@std/")) {
    const compat = nodeStdCompatTarget(context.nodeStdShims, specifier);
    return compat !== null && findFile(compat);
  }
  return false;
}

/** Would Bun resolve this specifier to a file? */
export function resolvesOnBun(
  specifier: string,
  context: RuntimeResolutionContext,
): boolean {
  // Bun has no `jsr:` protocol, tsconfig `paths` cannot hold a `jsr:` key, and
  // the alias plugin's `onResolve` filter cannot match a `jsr:` specifier.
  // Nothing anywhere in the repo can rescue it.
  if (specifier.startsWith("jsr:")) return false;

  // tsconfig `paths` is the only mechanism that reaches Bun for a std
  // specifier. The preload plugin is provably never consulted for one, and
  // Bun does not read deno.json. No `@std/` -> `#std/` normalisation either:
  // tsconfig lists both spellings explicitly, precisely because there is none.
  const target = resolveTsconfigPath(context.tsconfigPaths, specifier);
  if (!target) return false;

  return existsWithCandidates(
    target,
    BUN_FILE_SUFFIXES,
    BUN_INDEX_FILES,
    context.fileExists,
  );
}

/** Shimmed means BOTH runtimes resolve it, so the stricter of the two wins. */
export function isShimmedEverywhere(
  specifier: string,
  context: RuntimeResolutionContext,
): boolean {
  return resolvesOnNode(specifier, context) &&
    resolvesOnBun(specifier, context);
}

/**
 * Classify every std/jsr import in `imports` (already collected across the
 * cross-runtime roots).
 */
export function auditCrossRuntimeImports(
  imports: readonly CrossRuntimeImport[],
  context: RuntimeResolutionContext,
): CrossRuntimeAudit {
  const directJsrImports: CrossRuntimeImport[] = [];
  const dependents = new Map<string, Set<string>>();

  for (const entry of imports) {
    if (!isStdOrJsrSpecifier(entry.specifier)) continue;
    if (entry.specifier.startsWith("jsr:")) {
      directJsrImports.push(entry);
      continue;
    }
    if (isShimmedEverywhere(entry.specifier, context)) continue;
    const files = dependents.get(entry.specifier) ?? new Set<string>();
    files.add(entry.file);
    dependents.set(entry.specifier, files);
  }

  const unshimmedDependents = new Map<string, readonly string[]>();
  for (const specifier of [...dependents.keys()].sort()) {
    unshimmedDependents.set(
      specifier,
      [...dependents.get(specifier)!].sort(),
    );
  }

  return {
    directJsrImports: directJsrImports.slice().sort((a, b) =>
      a.file.localeCompare(b.file) || a.line - b.line
    ),
    unshimmedDependents,
  };
}

/**
 * Compare the live unshimmed set against the baseline. A baselined specifier
 * can leave the set for two very different reasons: a shim landed, or nothing
 * imports it any more. The two need different follow-up edits, so they
 * are reported separately rather than collapsed into one "stale" bucket.
 */
export function compareAgainstBaseline(
  audit: CrossRuntimeAudit,
  baseline: Readonly<Record<string, number>>,
  context: RuntimeResolutionContext,
): BaselineComparison {
  const newSpecifiers: GrownEntry[] = [];
  const grown: GrownEntry[] = [];
  const shrunk: ShrunkEntry[] = [];
  const staleShimmed: string[] = [];
  const staleUnused: string[] = [];

  for (const [specifier, files] of audit.unshimmedDependents) {
    const allowed = baseline[specifier];
    if (allowed === undefined) {
      newSpecifiers.push({
        specifier,
        baseline: 0,
        current: files.length,
        files,
      });
      continue;
    }
    if (files.length > allowed) {
      grown.push({
        specifier,
        baseline: allowed,
        current: files.length,
        files,
      });
      continue;
    }
    if (files.length < allowed) {
      shrunk.push({ specifier, baseline: allowed, current: files.length });
    }
  }

  for (const specifier of Object.keys(baseline).sort()) {
    if (audit.unshimmedDependents.has(specifier)) continue;
    if (isShimmedEverywhere(specifier, context)) {
      staleShimmed.push(specifier);
    } else {
      staleUnused.push(specifier);
    }
  }

  return { newSpecifiers, grown, shrunk, staleShimmed, staleUnused };
}

function hasRegressions(comparison: BaselineComparison): boolean {
  return comparison.newSpecifiers.length > 0 || comparison.grown.length > 0;
}

export function hasFailures(comparison: BaselineComparison): boolean {
  return hasRegressions(comparison) ||
    comparison.shrunk.length > 0 ||
    comparison.staleShimmed.length > 0 ||
    comparison.staleUnused.length > 0;
}

async function collectCrossRuntimeFiles(
  root: string,
  out: string[],
): Promise<void> {
  // `Deno.readDir` is lazy: a missing root raises when iteration starts, not
  // when it is called, so guarding the call alone caught nothing. Only an
  // absent root is expected -- a permissions failure or an I/O error is a
  // reason to stop, not to silently audit fewer files than the caller thinks.
  try {
    for await (const entry of Deno.readDir(root)) {
      if (entry.name === "node_modules") continue;
      const path = `${root}/${entry.name}`;
      if (entry.isDirectory) {
        await collectCrossRuntimeFiles(path, out);
      } else if (
        entry.isFile && (path.endsWith(".ts") || path.endsWith(".tsx")) &&
        !path.endsWith(".d.ts")
      ) {
        out.push(path);
      }
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
}

function fileExistsOnDisk(path: string): boolean {
  try {
    return Deno.statSync(path).isFile;
  } catch (_) {
    return false; // a missing candidate is the normal case while probing
  }
}

async function loadContext(): Promise<RuntimeResolutionContext> {
  const config = JSON.parse(await Deno.readTextFile(DENO_CONFIG_PATH)) as {
    imports?: Record<string, unknown>;
  };
  const imports = Object.fromEntries(
    Object.entries(config.imports ?? {}).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  const tsconfig = JSON.parse(await Deno.readTextFile(TSCONFIG_PATH)) as {
    compilerOptions?: { paths?: Record<string, unknown> };
  };
  return {
    imports,
    nodeStdShims: parseStdShimMap(
      await Deno.readTextFile(NODE_RESOLVER_PATH),
    ),
    tsconfigPaths: flattenTsconfigPaths(tsconfig.compilerOptions?.paths ?? {}),
    fileExists: fileExistsOnDisk,
  };
}

async function collectImports(): Promise<{
  imports: CrossRuntimeImport[];
  parseFailures: string[];
}> {
  const files: string[] = [];
  for (const root of CROSS_RUNTIME_ROOTS) {
    await collectCrossRuntimeFiles(root, files);
  }
  files.sort();

  const imports: CrossRuntimeImport[] = [];
  const parseFailures: string[] = [];
  for (const file of files) {
    let references;
    try {
      references = extractImports(file, await Deno.readTextFile(file));
    } catch (error) {
      parseFailures.push(
        `${file}: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }
    for (const reference of references) {
      // Type-only imports are erased before Node or Bun ever resolves them,
      // so they cannot break either runtime.
      if (reference.kind === "type") continue;
      if (!isStdOrJsrSpecifier(reference.specifier)) continue;
      imports.push({
        file,
        line: reference.line,
        specifier: reference.specifier,
      });
    }
  }
  return { imports, parseFailures };
}

function formatBaselineLiteral(
  audit: CrossRuntimeAudit,
): string {
  const lines = [...audit.unshimmedDependents].map(([specifier, files]) =>
    `  "${specifier}": ${files.length},`
  );
  return lines.length > 0 ? `{\n${lines.join("\n")}\n}` : "{}";
}

function reportDirectJsrImports(
  audit: CrossRuntimeAudit,
): void {
  if (audit.directJsrImports.length === 0) return;
  console.error(
    `Direct jsr: imports in cross-runtime code (${audit.directJsrImports.length}):`,
  );
  for (const entry of audit.directJsrImports) {
    console.error(`  ${entry.file}:${entry.line} imports "${entry.specifier}"`);
  }
  console.error(
    `  Bun cannot resolve a jsr: specifier under any circumstances: it has no ` +
      `jsr: protocol, ${TSCONFIG_PATH} paths cannot hold a jsr: key, and the ` +
      `alias plugin in ${BUN_PRELOAD_PATH} filters on ` +
      `#deno-config/@std//#std//std//#veryfront//veryfront//react, which no ` +
      `jsr: specifier matches. Node resolving it proves nothing, and neither ` +
      `does the equivalent #std/ alias being shimmed. Import that #std/... ` +
      `alias instead.`,
  );
}

/** Name the runtimes that cannot resolve `specifier`, for the failure text. */
export function failingRuntimes(
  specifier: string,
  context: RuntimeResolutionContext,
): string[] {
  const failing: string[] = [];
  if (!resolvesOnNode(specifier, context)) failing.push("Node");
  if (!resolvesOnBun(specifier, context)) failing.push("Bun");
  return failing;
}

function reportBaselineFailures(
  comparison: BaselineComparison,
  audit: CrossRuntimeAudit,
  context: RuntimeResolutionContext,
): void {
  const describe = (specifier: string) =>
    `fails on ${failingRuntimes(specifier, context).join(" and ")}`;

  for (const entry of comparison.newSpecifiers) {
    console.error(
      `New unshimmed std specifier "${entry.specifier}" ` +
        `(${describe(entry.specifier)}; ${entry.current} dependent file(s)): ` +
        `${entry.files.join(", ")}`,
    );
  }
  for (const entry of comparison.grown) {
    const where = describe(entry.specifier);
    const files = entry.files.join(", ");
    console.error(
      `Unshimmed std specifier "${entry.specifier}" (${where}) gained ` +
        `dependents: ${entry.current} > baseline ${entry.baseline}. ` +
        `Now imported by: ${files}`,
    );
  }
  if (!hasRegressions(comparison)) return;
  console.error(
    `  These specifiers resolve on Deno but not on every runtime, so each ` +
      `dependent file is a broken \`deno task test:node\` / \`test:bun\` run. ` +
      `To shim one, all three of these must line up:\n` +
      `    1. a local file under src/platform/compat/std/\n` +
      `    2. a ${DENO_CONFIG_PATH} "imports" entry with a "./" target (Deno + Node)\n` +
      `    3. a ${TSCONFIG_PATH} "paths" entry with the SAME key (Bun reads ` +
      `neither ${DENO_CONFIG_PATH} nor ${BUN_PRELOAD_PATH} for std specifiers, ` +
      `and does no "@std/" -> "#std/" or ".ts" fallback, so map every spelling ` +
      `you import)\n` +
      `  Otherwise drop the import. Raising UNSHIMMED_STD_BASELINE is not the ` +
      `fix.\n  Current state:\n${formatBaselineLiteral(audit)}`,
  );
}

function reportImprovements(comparison: BaselineComparison): void {
  for (const specifier of comparison.staleShimmed) {
    console.log(
      `"${specifier}" now resolves on both Node and Bun because a local shim landed. ` +
        `Delete its UNSHIMMED_STD_BASELINE entry in audit-cross-runtime-jsr.ts.`,
    );
  }
  for (const specifier of comparison.staleUnused) {
    console.log(
      `"${specifier}" is still unshimmed but no longer imported from ` +
        `${CROSS_RUNTIME_ROOTS.join("/")}. Delete its UNSHIMMED_STD_BASELINE ` +
        `entry in audit-cross-runtime-jsr.ts so it cannot come back for free.`,
    );
  }
  for (const entry of comparison.shrunk) {
    console.log(
      `"${entry.specifier}" dropped to ${entry.current} dependent(s) ` +
        `(baseline ${entry.baseline}). Lower its UNSHIMMED_STD_BASELINE entry ` +
        `to ${entry.current} to lock it in.`,
    );
  }
}

async function main(): Promise<void> {
  const context = await loadContext();
  if (
    Object.keys(context.nodeStdShims).length === 0 ||
    Object.keys(context.tsconfigPaths).length === 0
  ) {
    console.error(
      `Could not read the stdImportMap literal from ${NODE_RESOLVER_PATH}, or ` +
        `compilerOptions.paths from ${TSCONFIG_PATH}. This audit models those ` +
        `two resolvers; refusing to report a pass it cannot justify.`,
    );
    Deno.exit(1);
  }

  const { imports, parseFailures } = await collectImports();
  if (parseFailures.length > 0) {
    console.error(`Failed to parse ${parseFailures.length} file(s):`);
    for (const failure of parseFailures) console.error(`  ${failure}`);
    Deno.exit(1);
  }

  const audit = auditCrossRuntimeImports(imports, context);
  const comparison = compareAgainstBaseline(
    audit,
    UNSHIMMED_STD_BASELINE,
    context,
  );

  reportDirectJsrImports(audit);
  reportBaselineFailures(comparison, audit, context);
  reportImprovements(comparison);
  if (audit.directJsrImports.length > 0 || hasFailures(comparison)) {
    Deno.exit(1);
  }

  const total = [...audit.unshimmedDependents.values()].reduce(
    (sum, files) => sum + files.length,
    0,
  );
  console.log(
    `Cross-runtime jsr audit ok: 0 direct jsr: imports, ` +
      `${audit.unshimmedDependents.size} baselined unshimmed specifier(s) ` +
      `across ${total} dependent file(s).`,
  );
}

if (import.meta.main) {
  await main();
}

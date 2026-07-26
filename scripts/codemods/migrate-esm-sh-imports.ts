#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env=BABEL_TYPES_8_BREAKING

import { parse } from "npm:@babel/parser@7.29.2";
import * as generateModule from "npm:@babel/generator@7.29.1";
import * as t from "npm:@babel/types@7.29.0";

interface BabelGeneratorResult {
  code: string;
}

type GenerateFunction = (
  ast: t.Node,
  options?: Record<string, unknown>,
  source?: string,
) => BabelGeneratorResult;

interface ModuleWithDefault<T> {
  default: T | { default: T };
}

function resolveDefaultExport<T>(module: unknown): T {
  const candidate = module as ModuleWithDefault<T>;
  if (typeof candidate.default === "function") return candidate.default as T;
  const nested = candidate.default as { default?: T } | undefined;
  if (typeof nested?.default === "function") return nested.default as T;
  return module as T;
}

const generate = resolveDefaultExport<GenerateFunction>(generateModule);

// Matches esm.sh URLs with optional build-version prefix (v135/), scoped packages
// (@scope/name), subpaths, and query params.  Query params are captured separately
// so they can be dropped from the bare specifier.
//
// Groups: (1) package name, (2) version, (3) subpath (leading slash included)
const ESM_SH_URL_RE =
  /^https:\/\/esm\.sh\/(?:v\d+\/)?(@[^/@]+\/[^/@?]+|[^@/?]+)(?:@([^/?]+))?(\/[^?]*)?(?:\?.*)?$/;

// React-family specifiers are managed by the Veryfront import map; leave them alone.
const REACT_SKIP_PACKAGES = new Set(["react", "react-dom"]);

// Directory names skipped during source-file collection.
const SKIP_DIRS = new Set(["node_modules", ".veryfront", "dist", ".git"]);

// Source file extensions to process.
const SOURCE_FILE_RE = /\.[cm]?[jt]sx?$/;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Result produced by {@link migrateEsmShImports} for a single source file. */
export interface EsmShFileResult {
  code: string;
  changed: boolean;
  /** Specifier rewrites performed in this file. */
  rewrites: Array<{ from: string; to: string }>;
  /** Packages whose versioned URL contributed a pin (pkg -> version). */
  pins: Record<string, string>;
  /** Packages whose URL carried no version — must be resolved externally. */
  needsResolution: string[];
  /**
   * Intra-file version conflicts: same package appeared at two different
   * versions within this file.  The first version seen wins; the second is
   * recorded here rather than silently dropped.
   */
  conflicts: Array<{ pkg: string; existing: string; fromVersion: string }>;
}

/** Result of merging URL-derived pins with an existing package.json dependencies map. */
export interface PinMergeResult {
  /** Updated dependencies map (existing entries win over URL-derived ones, whether exact or a range). */
  updatedDeps: Record<string, string>;
  /** Packages where an existing pin conflicted with the URL-derived version. */
  conflicts: Array<{ pkg: string; existing: string; fromVersion: string }>;
}

/** JSON summary emitted by the CLI runner. */
export interface EsmShReport {
  filesChanged: number;
  rewrites: Array<{ file: string; from: string; to: string }>;
  pins: Record<string, string>;
  needsResolution: string[];
  conflicts: Array<{ pkg: string; existing: string; fromVersion: string }>;
  /** Non-fatal errors encountered during the run (e.g. unreadable package.json). */
  errors: string[];
}

/** Result of reading an existing package.json from disk. */
export interface PackageJsonReadResult {
  data: Record<string, unknown>;
  existingDeps: Record<string, string>;
  /** Set when the file exists but could not be parsed; the file must not be overwritten. */
  parseError: string | null;
}

// ---------------------------------------------------------------------------
// URL parsing
// ---------------------------------------------------------------------------

interface EsmShParsed {
  pkg: string;
  version?: string;
  subpath?: string;
}

function parseEsmShUrl(url: string): EsmShParsed | null {
  const m = ESM_SH_URL_RE.exec(url);
  if (!m) return null;
  return {
    pkg: m[1]!,
    version: m[2] ?? undefined,
    subpath: m[3] ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// AST helpers
// ---------------------------------------------------------------------------

function walkAst(node: t.Node, visit: (node: t.Node) => void): void {
  visit(node);
  const keys = (t.VISITOR_KEYS as Record<string, readonly string[]>)[node.type] ?? [];
  const record = node as unknown as Record<string, unknown>;
  for (const key of keys) {
    const child = record[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        if (item && typeof item === "object" && "type" in item) {
          walkAst(item as t.Node, visit);
        }
      }
    } else if (child && typeof child === "object" && "type" in child) {
      walkAst(child as t.Node, visit);
    }
  }
}

function processStringLiteral(
  literal: t.StringLiteral,
  rewrites: Array<{ from: string; to: string }>,
  pins: Record<string, string>,
  needsResolution: Set<string>,
  conflicts: Array<{ pkg: string; existing: string; fromVersion: string }>,
): boolean {
  const url = literal.value;
  if (!url.startsWith("https://esm.sh/")) return false;

  const parsed = parseEsmShUrl(url);
  if (!parsed) return false;
  if (REACT_SKIP_PACKAGES.has(parsed.pkg)) return false;

  const bare = parsed.pkg + (parsed.subpath ?? "");

  if (parsed.version) {
    if (parsed.pkg in pins) {
      // Same package appeared at a different version earlier in this file.
      if (pins[parsed.pkg] !== parsed.version) {
        conflicts.push({
          pkg: parsed.pkg,
          existing: pins[parsed.pkg]!,
          fromVersion: parsed.version,
        });
      }
      // First version seen wins — do not overwrite.
    } else {
      pins[parsed.pkg] = parsed.version;
    }
  } else {
    needsResolution.add(parsed.pkg);
  }

  rewrites.push({ from: url, to: bare });

  // Mutate the literal in place.  Update both value and extra.raw so the
  // generator emits the bare specifier preserving the original quote style.
  literal.value = bare;
  if (literal.extra) {
    const rawStr = literal.extra.raw as string | undefined;
    const quote = rawStr ? rawStr[0] : '"';
    literal.extra.raw = `${quote}${bare}${quote}`;
    literal.extra.rawValue = bare;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Core transform — pure function, no I/O
// ---------------------------------------------------------------------------

/** Rewrite esm.sh import/export/dynamic-import specifiers in a single source file. */
export function migrateEsmShImports(source: string): EsmShFileResult {
  const ast = parse(source, {
    sourceType: "module",
    plugins: ["typescript", "jsx"],
    allowImportExportEverywhere: true,
  });

  const rewrites: Array<{ from: string; to: string }> = [];
  const pins: Record<string, string> = {};
  const needsResolution = new Set<string>();
  const conflicts: Array<{ pkg: string; existing: string; fromVersion: string }> = [];
  let changed = false;

  // Static import / export-from declarations at the top level.
  for (const stmt of ast.program.body) {
    if (
      (t.isImportDeclaration(stmt) ||
        t.isExportNamedDeclaration(stmt) ||
        t.isExportAllDeclaration(stmt)) &&
      stmt.source
    ) {
      if (processStringLiteral(stmt.source, rewrites, pins, needsResolution, conflicts)) {
        changed = true;
      }
    }
  }

  // Dynamic import() expressions anywhere in the AST.
  // After the static pass above, already-rewritten import declarations no longer
  // start with "https://esm.sh/", so they are harmless no-ops if visited again.
  walkAst(ast.program as unknown as t.Node, (node) => {
    if (
      t.isCallExpression(node) &&
      t.isImport(node.callee) &&
      node.arguments.length > 0 &&
      t.isStringLiteral(node.arguments[0])
    ) {
      if (
        processStringLiteral(
          node.arguments[0] as t.StringLiteral,
          rewrites,
          pins,
          needsResolution,
          conflicts,
        )
      ) {
        changed = true;
      }
    }
  });

  if (!changed) {
    return {
      code: source,
      changed: false,
      rewrites: [],
      pins: {},
      needsResolution: [],
      conflicts: [],
    };
  }

  return {
    code: generate(ast as unknown as t.Node, {
      comments: true,
      retainLines: false,
      jsescOption: { minimal: true },
    }, source).code + (source.endsWith("\n") ? "\n" : ""),
    changed: true,
    rewrites,
    pins,
    needsResolution: [...needsResolution],
    conflicts,
  };
}

// ---------------------------------------------------------------------------
// Pin merge — pure function, testable without I/O
// ---------------------------------------------------------------------------

/**
 * Merge URL-derived pins into an existing dependencies map.
 *
 * Existing entries win over URL-derived versions.  Every conflict is recorded
 * so the caller can include it in the report.
 */
export function mergeEsmShPins(
  existingDeps: Record<string, string>,
  newPins: Record<string, string>,
): PinMergeResult {
  const updatedDeps = { ...existingDeps };
  const conflicts: Array<{ pkg: string; existing: string; fromVersion: string }> = [];

  for (const [pkg, version] of Object.entries(newPins)) {
    if (pkg in existingDeps) {
      if (existingDeps[pkg] !== version) {
        conflicts.push({ pkg, existing: existingDeps[pkg]!, fromVersion: version });
      }
      // Existing pin wins — do not overwrite.
    } else {
      updatedDeps[pkg] = version;
    }
  }

  return { updatedDeps, conflicts };
}

// ---------------------------------------------------------------------------
// I/O helpers — exported for testing
// ---------------------------------------------------------------------------

/**
 * Read and parse the project's package.json.
 *
 * Returns `parseError: null` when the file is absent (treat as empty).
 * Returns a non-null `parseError` when the file exists but is corrupt — the
 * caller must NOT overwrite the file in that case.
 */
export async function readProjectPackageJson(path: string): Promise<PackageJsonReadResult> {
  let text: string;
  try {
    text = await Deno.readTextFile(path);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      // File does not exist — treat as absent, start with empty deps.
      return { data: {}, existingDeps: {}, parseError: null };
    }
    // Any other error (permission denied, I/O failure, etc.) must not be
    // silently treated as "absent" — that would risk overwriting a file we
    // could not safely read.  Surface the error so the caller skips the write.
    return {
      data: {},
      existingDeps: {},
      parseError: `package.json could not be read: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  try {
    const data = JSON.parse(text) as Record<string, unknown>;
    const existingDeps = data["dependencies"] && typeof data["dependencies"] === "object"
      ? (data["dependencies"] as Record<string, string>)
      : {};
    return { data, existingDeps, parseError: null };
  } catch (e) {
    return {
      data: {},
      existingDeps: {},
      parseError: `package.json exists but could not be parsed: ${
        e instanceof Error ? e.message : String(e)
      }`,
    };
  }
}

/**
 * Remove packages from `needsResolution` that already have a resolved pin
 * somewhere in the same run.  A versioned import in one file provides enough
 * information to pin the package even if another file imports it without a version.
 */
export function filterNeedsResolution(
  needsResolution: Iterable<string>,
  pins: Record<string, string>,
): string[] {
  return [...needsResolution].filter((pkg) => !(pkg in pins)).sort();
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface CliOptions {
  projectDir: string;
  dryRun: boolean;
}

export function parseCliOptions(args: string[]): CliOptions {
  let projectDir: string | undefined;
  let dryRun = false;

  for (const arg of args) {
    if (arg === "--") continue;
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: deno task codemod:esm-sh -- [--dry-run] <project-directory>",
      );
      Deno.exit(0);
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      if (projectDir !== undefined) {
        throw new Error("Expected a single project directory.");
      }
      projectDir = arg;
    }
  }

  if (!projectDir) throw new Error("Provide a project directory.");
  return { projectDir, dryRun };
}

async function collectSourceFiles(dir: string, files: string[]): Promise<void> {
  for await (const entry of Deno.readDir(dir)) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory) {
      await collectSourceFiles(path, files);
    } else if (entry.isFile && SOURCE_FILE_RE.test(entry.name)) {
      files.push(path);
    }
  }
}

async function main(args: string[]): Promise<void> {
  const { projectDir, dryRun } = parseCliOptions(args);

  const sourceFiles: string[] = [];
  await collectSourceFiles(projectDir, sourceFiles);
  sourceFiles.sort();

  const report: EsmShReport = {
    filesChanged: 0,
    rewrites: [],
    pins: {},
    needsResolution: [],
    conflicts: [],
    errors: [],
  };

  // Collect pins across all files; first version seen for a package wins.
  const allPins = new Map<string, string>();
  const allNeedsResolution = new Set<string>();

  // Defer writes so we only touch the filesystem once.
  const fileResults: Array<{ file: string; code: string }> = [];

  for (const file of sourceFiles) {
    const source = await Deno.readTextFile(file);
    let result: EsmShFileResult;
    try {
      result = migrateEsmShImports(source);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to migrate ${file}: ${message}`, {
        cause: error,
      });
    }
    if (!result.changed) continue;

    fileResults.push({ file, code: result.code });
    report.filesChanged++;
    for (const rw of result.rewrites) {
      report.rewrites.push({ file, from: rw.from, to: rw.to });
    }
    // Intra-file version conflicts (same package, two different versions in one file).
    report.conflicts.push(...result.conflicts);

    for (const [pkg, version] of Object.entries(result.pins)) {
      const existing = allPins.get(pkg);
      if (existing !== undefined && existing !== version) {
        // Two different file-level URLs disagree; first file wins.
        report.conflicts.push({ pkg, existing, fromVersion: version });
      } else if (existing === undefined) {
        allPins.set(pkg, version);
      }
    }

    for (const pkg of result.needsResolution) {
      allNeedsResolution.add(pkg);
    }
  }

  // Read existing package.json.  A corrupt file must not be overwritten.
  const pkgJsonPath = `${projectDir}/package.json`;
  const {
    data: pkgJson,
    existingDeps,
    parseError: pkgJsonParseError,
  } = await readProjectPackageJson(pkgJsonPath);

  const newPinsRecord = Object.fromEntries(allPins.entries());
  const { updatedDeps, conflicts: pinConflicts } = mergeEsmShPins(existingDeps, newPinsRecord);
  report.conflicts.push(...pinConflicts);
  report.pins = newPinsRecord;
  // Packages that appear as unversioned in some files but versioned in others
  // are resolved by the pin; exclude them from needsResolution.
  report.needsResolution = filterNeedsResolution(allNeedsResolution, newPinsRecord);

  if (pkgJsonParseError) {
    // Abort without touching any source files: rewriting sources without
    // recording the corresponding pins would permanently discard version
    // information.  A versioned esm.sh URL would become a bare specifier
    // with no pin entry anywhere, so the platform would later resolve it to
    // latest — silently destroying the user's pinned version.
    report.errors.push(pkgJsonParseError);
    report.filesChanged = 0;
    report.rewrites = [];
    console.log(JSON.stringify(report, null, 2));
    throw new Error(pkgJsonParseError);
  }

  if (!dryRun) {
    // Write package.json FIRST so that an interrupted run never leaves bare
    // specifiers in source files without a corresponding pin entry.
    if (JSON.stringify(updatedDeps) !== JSON.stringify(existingDeps)) {
      pkgJson["dependencies"] = updatedDeps;
      await Deno.writeTextFile(pkgJsonPath, JSON.stringify(pkgJson, null, 2) + "\n");
    }

    for (const { file, code } of fileResults) {
      await Deno.writeTextFile(file, code);
    }
  }

  console.log(JSON.stringify(report, null, 2));
}

/** Export for integration testing. */
export { main };

if (import.meta.main) {
  await main(Deno.args).catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    Deno.exit(1);
  });
}

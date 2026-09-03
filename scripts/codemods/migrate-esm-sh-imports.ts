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

// Matches the path portion of a canonical npm-backed esm.sh URL after any
// build-version prefix (v135/) has been removed.
//
// Groups: (1) package name, (2) version, (3) subpath (leading slash included)
const ESM_SH_PATH_RE =
  /^(@[A-Za-z0-9][A-Za-z0-9._~-]*\/[A-Za-z0-9][A-Za-z0-9._~-]*|[A-Za-z0-9][A-Za-z0-9._~-]*)(?:@([^/]+))?(\/(?!\/).+)?$/;

const ESM_SH_SUBPATH_SEGMENT_RE = /^[A-Za-z0-9@._~!$&'()*+,;=-]+$/;

// Routes served by esm.sh itself rather than by its npm package resolver.
// Prefix entries include a trailing slash so npm packages with the same bare
// name (for example "node" or "pr") remain eligible for migration.
const ESM_SH_NON_NPM_EXACT_PATHS = new Set([
  "error.js",
  "favicon.ico",
  "install",
  "robots.txt",
  "run",
  "status.json",
  "tsx",
]);
const ESM_SH_NON_NPM_PREFIXES = [
  "embed/",
  "gh/",
  "github.com/",
  "jsr/",
  "node/",
  "pkg.pr.new/",
  "pr/",
];

// SemVer 2.0.0 without range operators, tags, partial versions, or a leading v.
const EXACT_SEMVER_RE =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

// React-family specifiers are managed by the Veryfront import map; leave them alone.
const REACT_SKIP_PACKAGES = new Set(["react", "react-dom"]);
const NO_SKIPPED_PACKAGES: ReadonlySet<string> = new Set();

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
  /** Packages whose URL carried no version, must be resolved externally. */
  needsResolution: string[];
  /**
   * Intra-file version conflicts: same package appeared at two different
   * versions within this file.  The first version seen wins; the second is
   * recorded here rather than silently dropped.  `specifier` is the original
   * URL of the conflicting (second) import.
   */
  conflicts: Array<{ pkg: string; existing: string; fromVersion: string; specifier: string }>;
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
  /**
   * Version conflicts encountered during preflight. The default migration
   * skips every rewrite for a conflicting package and continues with
   * independent packages. Each entry carries the source `file` and original
   * `specifier` (URL) so the operator can locate and review the conflict. Use
   * `--fail-on-conflict` to exit non-zero without writing any files.
   */
  conflicts: Array<{
    pkg: string;
    existing: string;
    fromVersion: string;
    file: string;
    specifier: string;
  }>;
  /**
   * Errors encountered during the run.  May include a fatal abort reason (e.g.
   * corrupt or unreadable package.json): when a fatal error is present no source
   * files have been written and the process exits non-zero.
   */
  errors: string[];
}

/** Result of reading an existing package.json from disk. */
export interface PackageJsonReadResult {
  data: Record<string, unknown>;
  existingDeps: Record<string, string>;
  /**
   * Declarations found in the other dependency fields (devDependencies,
   * peerDependencies, optionalDependencies): pkg -> first field seen + its
   * version.  Used to detect cross-field version disagreements before a
   * URL-derived pin is added to `dependencies`.
   */
  otherFieldDeps: Record<string, { field: string; version: string }>;
  /** Set when the file could not be read, parsed, or validated; it must not be overwritten. */
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
  const prefix = "https://esm.sh/";
  if (!url.startsWith(prefix)) return null;

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return null;
  }

  // URL parsing normalizes dot segments, backslashes, control characters, and
  // other non-canonical spellings. Rewriting is safe only when normalization
  // leaves the complete URL untouched.
  if (parsedUrl.href !== url || parsedUrl.origin !== "https://esm.sh") return null;
  if (parsedUrl.search || parsedUrl.hash || parsedUrl.pathname.includes("%")) return null;

  let path = parsedUrl.pathname.slice(1);

  const servedPrefix = /^(?:stable|v\d+)\//.exec(path);
  if (servedPrefix) path = path.slice(servedPrefix[0].length);

  // esm.sh also serves built-in scripts, runtime shims, repository previews,
  // and other non-npm resources. They cannot be represented safely in
  // package.json dependencies.
  if (
    ESM_SH_NON_NPM_EXACT_PATHS.has(path) ||
    ESM_SH_NON_NPM_PREFIXES.some((prefix) => path.startsWith(prefix))
  ) {
    return null;
  }

  const m = ESM_SH_PATH_RE.exec(path);
  if (!m) return null;
  if (m[2] !== undefined && !EXACT_SEMVER_RE.test(m[2])) return null;
  if (
    m[3] !== undefined &&
    m[3].slice(1).split("/").some((segment) =>
      segment === "." || segment === ".." || !ESM_SH_SUBPATH_SEGMENT_RE.test(segment)
    )
  ) {
    return null;
  }

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
  conflicts: Array<{ pkg: string; existing: string; fromVersion: string; specifier: string }>,
  skippedPackages: ReadonlySet<string>,
): boolean {
  const url = literal.value;
  if (!url.startsWith("https://esm.sh/")) return false;

  const parsed = parseEsmShUrl(url);
  if (!parsed) return false;
  if (REACT_SKIP_PACKAGES.has(parsed.pkg)) return false;
  if (skippedPackages.has(parsed.pkg)) return false;

  const bare = parsed.pkg + (parsed.subpath ?? "");

  if (parsed.version) {
    if (Object.hasOwn(pins, parsed.pkg)) {
      // Same package appeared at a different version earlier in this file.
      if (pins[parsed.pkg] !== parsed.version) {
        conflicts.push({
          pkg: parsed.pkg,
          existing: pins[parsed.pkg]!,
          fromVersion: parsed.version,
          specifier: url,
        });
      }
      // First version seen wins, do not overwrite.
    } else {
      pins[parsed.pkg] = parsed.version;
    }
  } else {
    needsResolution.add(parsed.pkg);
  }

  rewrites.push({ from: url, to: bare });

  // Mutate the literal in place. Drop the parser's raw spelling so Babel
  // chooses and escapes a safe quote style for the new value. Reusing the
  // original quote can produce invalid code when a valid subpath contains it.
  literal.value = bare;
  delete literal.extra;

  return true;
}

// ---------------------------------------------------------------------------
// Core transform: pure function, no I/O
// ---------------------------------------------------------------------------

function transformEsmShImports(
  source: string,
  skippedPackages: ReadonlySet<string>,
): EsmShFileResult {
  const ast = parse(source, {
    sourceType: "module",
    plugins: ["typescript", "jsx"],
    allowImportExportEverywhere: true,
  });

  const rewrites: Array<{ from: string; to: string }> = [];
  // Use a null-prototype object so package names that match Object.prototype
  // keys ("toString", "hasOwnProperty", "__proto__", …) cannot cause spurious
  // conflict hits or prototype corruption.
  const pins = Object.create(null) as Record<string, string>;
  const needsResolution = new Set<string>();
  const conflicts: Array<{
    pkg: string;
    existing: string;
    fromVersion: string;
    specifier: string;
  }> = [];
  let changed = false;

  // Single AST walk handles both top-level and non-top-level import/export
  // declarations (allowImportExportEverywhere permits either), plus dynamic
  // import() expressions anywhere in the tree.  processStringLiteral is
  // idempotent: already-rewritten values no longer start with
  // "https://esm.sh/", so any node visited more than once is a safe no-op.
  walkAst(ast.program as unknown as t.Node, (node) => {
    if (
      (t.isImportDeclaration(node) ||
        t.isExportNamedDeclaration(node) ||
        t.isExportAllDeclaration(node)) &&
      node.source
    ) {
      if (
        processStringLiteral(
          node.source,
          rewrites,
          pins,
          needsResolution,
          conflicts,
          skippedPackages,
        )
      ) {
        changed = true;
      }
    } else if (
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
          skippedPackages,
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
    needsResolution: filterNeedsResolution(needsResolution, pins),
    conflicts,
  };
}

/** Rewrite esm.sh import/export/dynamic-import specifiers in a single source file. */
export function migrateEsmShImports(source: string): EsmShFileResult {
  return transformEsmShImports(source, NO_SKIPPED_PACKAGES);
}

// ---------------------------------------------------------------------------
// Pin merge: pure function, testable without I/O
// ---------------------------------------------------------------------------

/**
 * Merge URL-derived pins into an existing dependencies map.
 *
 * Existing entries win over URL-derived versions.  Every conflict is recorded
 * so the caller can include it in the report.
 *
 * When at least one new pin is inserted the merged map is returned with its
 * keys sorted alphabetically (the npm convention).  When nothing is inserted
 * the existing key order is preserved, so an idempotent re-run never rewrites
 * package.json just to re-order it.
 */
export function mergeEsmShPins(
  existingDeps: Record<string, string>,
  newPins: Record<string, string>,
): PinMergeResult {
  // Null-prototype object prevents a package named "__proto__" or "constructor"
  // from triggering an inherited setter when updatedDeps[pkg] = version is executed.
  // Object.assign copies only own enumerable properties from existingDeps, so the
  // null prototype is established before any URL-derived keys are written.
  const updatedDeps = Object.assign(
    Object.create(null) as Record<string, string>,
    existingDeps,
  );
  const conflicts: Array<{ pkg: string; existing: string; fromVersion: string }> = [];
  let inserted = false;

  for (const [pkg, version] of Object.entries(newPins)) {
    if (Object.hasOwn(existingDeps, pkg)) {
      if (existingDeps[pkg] !== version) {
        conflicts.push({ pkg, existing: existingDeps[pkg]!, fromVersion: version });
      }
      // Existing pin wins, do not overwrite.
    } else {
      updatedDeps[pkg] = version;
      inserted = true;
    }
  }

  if (!inserted) {
    return { updatedDeps, conflicts };
  }

  const sortedDeps = Object.create(null) as Record<string, string>;
  for (const pkg of Object.keys(updatedDeps).sort(compareCodeUnits)) {
    sortedDeps[pkg] = updatedDeps[pkg]!;
  }
  return { updatedDeps: sortedDeps, conflicts };
}

/** Code-unit ordering keeps output byte-stable across locales. */
function compareCodeUnits(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

// ---------------------------------------------------------------------------
// I/O helpers: exported for testing
// ---------------------------------------------------------------------------

function isPlainJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

const PATH_SEPARATOR = Deno.build.os === "windows" ? "\\" : "/";

/**
 * Prefix that every path strictly inside `root` must start with.
 *
 * A filesystem root such as `/` or a drive root already ends in the separator,
 * so appending another would produce `//` and reject every real child.
 */
function containmentPrefix(root: string): string {
  return root.endsWith(PATH_SEPARATOR) ? root : root + PATH_SEPARATOR;
}

/** Directory portion of `path`, accepting either separator spelling. */
function parentDirOf(path: string): string {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (index < 0) return ".";
  const parent = path.slice(0, index);
  return parent === "" ? PATH_SEPARATOR : parent;
}

/**
 * Fail closed before reading or writing a path collected under the project
 * directory.
 *
 * Deno.readTextFile/Deno.writeTextFile follow symlinks, so a malicious project
 * could plant package.json (or swap a collected source file) as a symlink,
 * possibly dangling, that points outside the project, turning the codemod's
 * --allow-write into an arbitrary file create/overwrite under the operator's
 * account.  Reject every symlink (lstat reports a dangling one too, as
 * isSymlink) and require the resolved path to stay inside the resolved project
 * root.
 *
 * `allowMissing` permits a genuinely absent file: package.json may not exist
 * yet.  The parent directory is still resolved and checked, so an intermediate
 * symlink cannot make the creating write land outside the project.
 *
 * Known limitation: a hardlink is indistinguishable from the file it shares an
 * inode with, so lstat reports a regular file and realPath stays inside the
 * project.  Rewriting through one edits the outside file.  Creating a hardlink
 * requires write access to the target's filesystem and directory, so this
 * residual is out of scope for this guard.
 */
export async function assertPathInsideProject(
  path: string,
  projectRoot: string,
  { allowMissing = false }: { allowMissing?: boolean } = {},
): Promise<void> {
  const prefix = containmentPrefix(projectRoot);
  let info: Deno.FileInfo;
  try {
    info = await Deno.lstat(path);
  } catch (e) {
    if (allowMissing && e instanceof Deno.errors.NotFound) {
      // The file may still be created, but only where its existing parent
      // resolves inside the project.
      let realParent: string;
      try {
        realParent = await Deno.realPath(parentDirOf(path));
      } catch (parentError) {
        throw new Error(
          `Refusing to create ${path}: ${
            parentError instanceof Error ? parentError.message : String(parentError)
          }`,
        );
      }
      if (realParent !== projectRoot && !realParent.startsWith(prefix)) {
        throw new Error(`Refusing to create a path outside the project directory: ${path}`);
      }
      return;
    }
    throw new Error(
      `Refusing to touch ${path}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (info.isSymlink) {
    throw new Error(`Refusing to follow symlink: ${path}`);
  }
  const real = await Deno.realPath(path);
  if (real !== projectRoot && !real.startsWith(prefix)) {
    throw new Error(`Refusing to access path outside the project directory: ${path}`);
  }
}

/**
 * Read and parse the project's package.json.
 *
 * Returns `parseError: null` when the file is absent (treat as empty).
 * Returns a non-null `parseError` when the file exists but cannot be read,
 * parsed, or validated. The caller must NOT overwrite the file in that case.
 *
 * When `projectRoot` (the real path of the project directory) is provided, a
 * symlinked or out-of-project manifest is rejected as a `parseError` before
 * any read, so the caller aborts without following the link.
 */
export async function readProjectPackageJson(
  path: string,
  projectRoot?: string,
): Promise<PackageJsonReadResult> {
  if (projectRoot !== undefined) {
    try {
      await assertPathInsideProject(path, projectRoot, { allowMissing: true });
    } catch (e) {
      return {
        data: {},
        existingDeps: {},
        otherFieldDeps: {},
        parseError: `package.json could not be read: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }
  let text: string;
  try {
    text = await Deno.readTextFile(path);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      // File does not exist, treat as absent and start with empty deps.
      return { data: {}, existingDeps: {}, otherFieldDeps: {}, parseError: null };
    }
    // Any other error (permission denied, I/O failure, etc.) must not be
    // silently treated as "absent", which would risk overwriting a file we
    // could not safely read.  Surface the error so the caller skips the write.
    return {
      data: {},
      existingDeps: {},
      otherFieldDeps: {},
      parseError: `package.json could not be read: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!isPlainJsonObject(parsed)) {
      return {
        data: {},
        existingDeps: {},
        otherFieldDeps: {},
        parseError: "package.json root must be a JSON object.",
      };
    }

    const dependencies = parsed["dependencies"];
    if (
      dependencies !== undefined &&
      (!isPlainJsonObject(dependencies) ||
        Object.values(dependencies).some((version) => typeof version !== "string"))
    ) {
      return {
        data: {},
        existingDeps: {},
        otherFieldDeps: {},
        parseError: "package.json dependencies must be a JSON object with string values.",
      };
    }

    // Collect declarations from the other dependency fields so the caller can
    // detect cross-field version disagreements. A malformed field aborts the
    // run the same way a malformed `dependencies` does: overlap cannot be
    // checked safely, so nothing may be written.
    const otherFieldDeps = Object.create(null) as Record<
      string,
      { field: string; version: string }
    >;
    for (const field of ["devDependencies", "peerDependencies", "optionalDependencies"]) {
      const value = parsed[field];
      if (value === undefined) continue;
      if (
        !isPlainJsonObject(value) ||
        Object.values(value).some((version) => typeof version !== "string")
      ) {
        return {
          data: {},
          existingDeps: {},
          otherFieldDeps: {},
          parseError: `package.json ${field} must be a JSON object with string values.`,
        };
      }
      for (const [pkg, version] of Object.entries(value as Record<string, string>)) {
        if (!Object.hasOwn(otherFieldDeps, pkg)) {
          otherFieldDeps[pkg] = { field, version };
        }
      }
    }

    const existingDeps = (dependencies ?? {}) as Record<string, string>;
    const data = parsed;
    return { data, existingDeps, otherFieldDeps, parseError: null };
  } catch (e) {
    return {
      data: {},
      existingDeps: {},
      otherFieldDeps: {},
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
  return [...needsResolution].filter((pkg) => !Object.hasOwn(pins, pkg))
    .sort(compareCodeUnits);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface CliOptions {
  projectDir: string;
  dryRun: boolean;
  /** Exit before the write phase when preflight finds any version conflicts. */
  failOnConflict: boolean;
}

export function parseCliOptions(args: string[]): CliOptions {
  let projectDir: string | undefined;
  let dryRun = false;
  let failOnConflict = false;

  for (const arg of args) {
    if (arg === "--") continue;
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--fail-on-conflict") {
      failOnConflict = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: deno task codemod:esm-sh -- [--dry-run] [--fail-on-conflict] <project-directory>\n" +
          "\n" +
          "Rewrites esm.sh import URLs in source files to bare specifiers and pins\n" +
          "the extracted versions in package.json.\n" +
          "\n" +
          "Options:\n" +
          "  --dry-run           Report changes without writing any files.\n" +
          "  --fail-on-conflict  Exit non-zero without writing any files when version\n" +
          "                      conflicts are detected. By default, conflicting\n" +
          "                      packages are skipped and independent imports migrate.",
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
  return { projectDir, dryRun, failOnConflict };
}

async function collectSourceFiles(dir: string, files: string[]): Promise<void> {
  for await (const entry of Deno.readDir(dir)) {
    if (SKIP_DIRS.has(entry.name)) continue;
    // Never traverse or collect symlinks (readDir does not follow them, so a
    // link reports isSymlink rather than isFile/isDirectory): a link to a file
    // or directory outside the project must not be rewritten through the link.
    if (entry.isSymlink) continue;
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory) {
      await collectSourceFiles(path, files);
    } else if (entry.isFile && SOURCE_FILE_RE.test(entry.name)) {
      files.push(path);
    }
  }
}

/**
 * Select the rewrite specifier for a package, preferring the URL that carries
 * the target version.  When a file imports the same package both with and
 * without a version, a plain `.find()` on rewrites would return whichever URL
 * appeared first, which may be the unversioned one, making conflict reports
 * point at a URL that has nothing to do with the version mismatch.
 */
function pickSpecifier(
  rewrites: Array<{ from: string; to: string }>,
  pkg: string,
  version: string,
): string {
  const forPkg = rewrites.filter((r) => r.to === pkg || r.to.startsWith(pkg + "/"));
  return (
    forPkg.find((r) => {
      const parsed = parseEsmShUrl(r.from);
      return parsed?.pkg === pkg && parsed.version === version;
    })?.from ??
      forPkg[0]?.from ??
      `${pkg}@${version}`
  );
}

async function main(args: string[]): Promise<void> {
  const { projectDir, dryRun, failOnConflict } = parseCliOptions(args);

  // Resolve the project root once so every subsequent containment check
  // compares against a symlink-free absolute path.
  const projectRoot = await Deno.realPath(projectDir);
  const rootPrefix = containmentPrefix(projectRoot);
  // Traversal and writes use the resolved root, but the report keeps the
  // spelling the caller passed: a relative project directory stays relative,
  // and no machine-specific filesystem layout leaks into the JSON output.
  const displayRoot = projectDir.replace(/[/\\]+$/, "");
  const toReportPath = (absolute: string): string =>
    absolute.startsWith(rootPrefix)
      ? `${displayRoot}/${absolute.slice(rootPrefix.length)}`
      : absolute;

  const sourceFiles: string[] = [];
  await collectSourceFiles(projectRoot, sourceFiles);
  sourceFiles.sort(compareCodeUnits);

  const report: EsmShReport = {
    filesChanged: 0,
    rewrites: [],
    pins: {},
    needsResolution: [],
    conflicts: [],
    errors: [],
  };

  // Track the first-seen pin for each package across all files, including the
  // source file path and original URL so conflicts carry full location context.
  const allPins = new Map<string, { version: string; file: string; specifier: string }>();
  const analyzedFiles: Array<{ file: string; source: string; result: EsmShFileResult }> = [];

  for (const file of sourceFiles) {
    const reportFile = toReportPath(file);
    const source = await Deno.readTextFile(file);
    let result: EsmShFileResult;
    try {
      result = migrateEsmShImports(source);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to migrate ${reportFile}: ${message}`, {
        cause: error,
      });
    }
    if (!result.changed) continue;

    analyzedFiles.push({ file, source, result });
    // Collect every conflict before deciding which transformations are safe.
    for (const c of result.conflicts) {
      report.conflicts.push({ ...c, file: reportFile });
    }

    for (const [pkg, version] of Object.entries(result.pins)) {
      const existing = allPins.get(pkg);
      if (existing !== undefined && existing.version !== version) {
        // Two different files disagree on the version; first file seen wins.
        // Prefer the URL in this file that actually carries the conflicting
        // version. A file may also have an unversioned import of the same
        // package, and a plain find() would return whichever appeared first.
        const specifier = pickSpecifier(result.rewrites, pkg, version);
        report.conflicts.push({
          pkg,
          existing: existing.version,
          fromVersion: version,
          file: reportFile,
          specifier,
        });
      } else if (existing === undefined) {
        const specifier = pickSpecifier(result.rewrites, pkg, version);
        allPins.set(pkg, { version, file: reportFile, specifier });
      }
    }
  }

  // Read existing package.json.  A corrupt file must not be overwritten, and
  // a symlinked or out-of-project manifest must not be followed.
  const pkgJsonPath = `${projectRoot}/package.json`;
  const {
    data: pkgJson,
    existingDeps,
    otherFieldDeps,
    parseError: pkgJsonParseError,
  } = await readProjectPackageJson(pkgJsonPath, projectRoot);

  const candidatePins = Object.fromEntries(
    [...allPins.entries()].map(([pkg, { version }]) => [pkg, version]),
  );
  const { conflicts: pinConflicts } = mergeEsmShPins(existingDeps, candidatePins);
  // Enrich package.json merge conflicts with file + specifier from the allPins
  // tracker (the source file that introduced the URL-derived version).
  for (const c of pinConflicts) {
    const meta = allPins.get(c.pkg);
    report.conflicts.push({
      ...c,
      file: meta?.file ?? "",
      specifier: meta?.specifier ?? `${c.pkg}@${c.fromVersion}`,
    });
  }
  // A declaration in another dependency field (devDependencies,
  // peerDependencies, optionalDependencies) at a DIFFERENT version is a
  // cross-field conflict: adding the URL-derived pin to `dependencies` would
  // leave the project with two disagreeing declarations for one package.  A
  // matching version in another field is fine - the runtime import justifies
  // a `dependencies` entry.
  for (const [pkg, version] of Object.entries(candidatePins)) {
    if (!Object.hasOwn(otherFieldDeps, pkg)) continue;
    const other = otherFieldDeps[pkg]!;
    if (other.version === version) continue;
    const meta = allPins.get(pkg);
    report.conflicts.push({
      pkg,
      existing: `${other.version} (${other.field})`,
      fromVersion: version,
      file: meta?.file ?? "",
      specifier: meta?.specifier ?? `${pkg}@${version}`,
    });
  }
  report.pins = candidatePins;

  if (pkgJsonParseError) {
    // Abort without touching any source files: rewriting sources without
    // recording the corresponding pins would permanently discard version
    // information.  A versioned esm.sh URL would become a bare specifier
    // with no pin entry anywhere, so the platform would later resolve it to
    // latest, silently destroying the user's pinned version.
    report.errors.push(pkgJsonParseError);
    report.filesChanged = 0;
    report.rewrites = [];
    console.log(JSON.stringify(report, null, 2));
    throw new Error(pkgJsonParseError);
  }

  // A package with any version disagreement is unsafe to collapse to a single
  // bare specifier. Skip it everywhere in the project, including unversioned
  // imports, while allowing independent packages to migrate.
  const conflictedPackages = new Set(report.conflicts.map(({ pkg }) => pkg));
  const safePins = Object.fromEntries(
    Object.entries(candidatePins).filter(([pkg]) => !conflictedPackages.has(pkg)),
  );
  const { updatedDeps } = mergeEsmShPins(existingDeps, safePins);
  report.pins = safePins;

  const allNeedsResolution = new Set<string>();
  // Defer every write until analysis, manifest validation, conflict filtering,
  // and strict-mode gating have completed.
  const fileResults: Array<{ file: string; code: string }> = [];
  for (const { file, source, result: analyzedResult } of analyzedFiles) {
    const result = conflictedPackages.size === 0
      ? analyzedResult
      : transformEsmShImports(source, conflictedPackages);
    if (!result.changed) continue;

    fileResults.push({ file, code: result.code });
    report.filesChanged++;
    for (const rw of result.rewrites) {
      report.rewrites.push({ file: toReportPath(file), from: rw.from, to: rw.to });
    }
    for (const pkg of result.needsResolution) {
      allNeedsResolution.add(pkg);
    }
  }
  // Packages that appear as unversioned in some files but versioned in others
  // are resolved by the pin; exclude them from needsResolution.
  report.needsResolution = filterNeedsResolution(allNeedsResolution, safePins);

  if (failOnConflict && report.conflicts.length > 0) {
    console.log(JSON.stringify(report, null, 2));
    const n = report.conflicts.length;
    throw new Error(
      `${n} version conflict${
        n === 1 ? "" : "s"
      } detected. No files were written. Review the conflicts field in the report above.`,
    );
  }

  if (!dryRun) {
    // Write package.json FIRST so that an interrupted run never leaves bare
    // specifiers in source files without a corresponding pin entry.
    if (JSON.stringify(updatedDeps) !== JSON.stringify(existingDeps)) {
      pkgJson["dependencies"] = updatedDeps;
      // Re-check right before the write: writeTextFile follows symlinks, and
      // the manifest could have been swapped for a link since it was read.
      await assertPathInsideProject(pkgJsonPath, projectRoot, { allowMissing: true });
      await Deno.writeTextFile(pkgJsonPath, JSON.stringify(pkgJson, null, 2) + "\n");
    }

    for (const { file, code } of fileResults) {
      // Collected entries were regular files, but re-check before each write
      // in case one was swapped for a symlink after analysis.
      await assertPathInsideProject(file, projectRoot);
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

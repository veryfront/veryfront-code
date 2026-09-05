#!/usr/bin/env -S deno run --allow-read --allow-write --allow-ffi --allow-env=BABEL_TYPES_8_BREAKING

import { parse } from "npm:@babel/parser@7.29.2";
import * as generateModule from "npm:@babel/generator@7.29.1";
import * as t from "npm:@babel/types@7.29.0";
import { lstat as lstatNativeFile } from "node:fs/promises";
import { dirname as nativeDirname, isAbsolute, parse as parsePath, relative } from "node:path";
import {
  capturePinnedDirectoryIdentity,
  openPinnedPosixFile,
  openPinnedWindowsFile,
  type PinnedDirectoryIdentity,
  readPinnedDirectory,
} from "./pinned-directory.ts";

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
  /** Identity of the manifest handle whose bytes were parsed. */
  fileIdentity?: StableFileIdentity;
  /** Exact manifest text parsed during analysis. */
  sourceText?: string;
  /** True only when the guarded analysis observed no manifest at this path. */
  missingAtRead?: true;
}

export interface StableFileIdentity {
  device: string;
  inode: string;
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
  return nativeDirname(path);
}

class SafeFileGuardError extends Error {
  override readonly name = "SafeFileGuardError";
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
 * A path that exists must also be a regular file.  A FIFO, socket, or device
 * planted as package.json is not a symlink, but opening one blocks until a
 * peer connects, which hangs the codemod indefinitely.
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
        throw new SafeFileGuardError(
          "Refusing to create a file because its parent directory could not be verified.",
          { cause: parentError },
        );
      }
      if (realParent !== projectRoot && !realParent.startsWith(prefix)) {
        throw new SafeFileGuardError(
          "Refusing to create a path outside the project directory.",
        );
      }
      return;
    }
    throw new SafeFileGuardError(
      "Refusing to touch a path because its file type could not be verified.",
      { cause: e },
    );
  }
  if (info.isSymlink) {
    throw new SafeFileGuardError("Refusing to follow a symlink.");
  }
  if (!info.isFile) {
    throw new SafeFileGuardError("Refusing to use a path that is not a regular file.");
  }
  const real = await Deno.realPath(path);
  if (real !== projectRoot && !real.startsWith(prefix)) {
    throw new SafeFileGuardError("Refusing to access a path outside the project directory.");
  }
}

function stableFileIdentity(
  info: Readonly<{ dev: number | bigint | null; ino: number | bigint | null }>,
): StableFileIdentity {
  if (
    info.dev === null || info.ino === null ||
    (typeof info.dev === "number" && (!Number.isSafeInteger(info.dev) || info.dev <= 0)) ||
    (typeof info.ino === "number" && (!Number.isSafeInteger(info.ino) || info.ino <= 0)) ||
    (typeof info.dev === "bigint" && info.dev <= 0n) ||
    (typeof info.ino === "bigint" && info.ino <= 0n)
  ) {
    throw new SafeFileGuardError("Stable file identity is unavailable.");
  }
  return { device: String(info.dev), inode: String(info.ino) };
}

function sameFileIdentity(opened: StableFileIdentity, current: StableFileIdentity): boolean {
  return opened.device === current.device && opened.inode === current.inode;
}

function failedCreation(error: unknown, path: string): SafeFileGuardError {
  const reason = error instanceof SafeFileGuardError
    ? error.message
    : "File creation did not finish.";
  return new SafeFileGuardError(
    `${reason} A newly created file may remain at ${
      JSON.stringify(parsePath(path).base)
    }. Inspect it before retrying.`,
    { cause: error },
  );
}

async function openProjectFile(
  path: string,
  projectRoot: string,
  mode: "r" | "r+" | "wx+",
  rootIdentity?: PinnedDirectoryIdentity,
) {
  const parent = await Deno.realPath(nativeDirname(path));
  const canonicalPath = parent + "/" + parsePath(path).base;
  return Deno.build.os === "windows"
    ? openPinnedWindowsFile(canonicalPath, projectRoot, mode, rootIdentity)
    : openPinnedPosixFile(canonicalPath, projectRoot, mode, rootIdentity);
}

async function pathFileIdentity(
  path: string,
  projectRoot: string,
  rootIdentity?: PinnedDirectoryIdentity,
): Promise<StableFileIdentity> {
  const file = await openProjectFile(path, projectRoot, "r", rootIdentity);
  try {
    return stableFileIdentity(await file.stat({ bigint: true }));
  } finally {
    await file.close();
  }
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof Deno.errors.NotFound ||
    (typeof error === "object" && error !== null && "code" in error &&
      (error as { code?: unknown }).code === "ENOENT");
}

async function writeTextFileInsideProjectWithNativeHandle(
  path: string,
  projectRoot: string,
  content: string,
  expectedIdentity?: StableFileIdentity,
  expectedContent?: string,
  allowMissing = false,
  requireMissing = false,
  rootIdentity?: PinnedDirectoryIdentity,
): Promise<void> {
  // Open the destination before trusting its path, but do not mutate it until
  // the opened identity and current in-project path agree. A parent swapped to
  // a junction or symlink can redirect this open, but never a later write.
  let file: Awaited<ReturnType<typeof openProjectFile>>;
  let created = false;
  try {
    file = await openProjectFile(
      path,
      projectRoot,
      requireMissing ? "wx+" : "r+",
      rootIdentity,
    );
    created = requireMissing;
  } catch (error) {
    if (
      requireMissing || !allowMissing || (Deno.build.os === "windows" && !isNotFoundError(error))
    ) throw error;
    // "wx+" is O_CREAT|O_EXCL|O_RDWR: it fails instead of following a link
    // planted at the path, so creating an absent manifest stays contained.
    file = await openProjectFile(path, projectRoot, "wx+", rootIdentity);
    created = true;
  }
  try {
    const opened = stableFileIdentity(await file.stat({ bigint: true }));
    await assertPathInsideProject(path, projectRoot);
    if (!sameFileIdentity(opened, await pathFileIdentity(path, projectRoot, rootIdentity))) {
      throw new SafeFileGuardError("Refusing to write a path that changed after it was opened.");
    }
    if (expectedIdentity && !sameFileIdentity(expectedIdentity, opened)) {
      throw new SafeFileGuardError("Refusing to write a file because it changed after being read.");
    }
    if (expectedContent !== undefined) {
      const expected = new TextEncoder().encode(expectedContent);
      const current = new Uint8Array(expected.length + 1);
      let offset = 0;
      while (offset < current.length) {
        const { bytesRead } = await file.read(current, offset, current.length - offset, offset);
        if (bytesRead === 0) break;
        offset += bytesRead;
      }
      if (offset !== expected.length || !expected.every((byte, index) => current[index] === byte)) {
        throw new SafeFileGuardError(
          "Refusing to write a file because its contents changed after being read.",
        );
      }
    }
    await file.truncate(0);
    const bytes = new TextEncoder().encode(content);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesWritten } = await file.write(
        bytes,
        offset,
        bytes.length - offset,
        offset,
      );
      if (bytesWritten === 0) throw new SafeFileGuardError("Could not finish writing the file.");
      offset += bytesWritten;
    }
    let unchanged = false;
    try {
      unchanged = sameFileIdentity(
        opened,
        await pathFileIdentity(path, projectRoot, rootIdentity),
      );
    } catch { /* A missing or linked destination is no longer the opened file. */ }
    if (!unchanged) {
      throw new SafeFileGuardError(
        "Refusing to finish a write because the destination path changed.",
      );
    }
  } catch (error) {
    throw created ? failedCreation(error, path) : error;
  } finally {
    await file.close();
  }
}

/**
 * Write through a verified file handle so a later path swap cannot redirect
 * truncation or content outside the project.
 *
 * `allowMissing` creates the file when it does not exist yet, which the
 * manifest write needs: a project with esm.sh URLs and no package.json is the
 * codemod's main case.  Creation uses exclusive open semantics, so a symlink
 * planted at the path fails the create instead of being followed. If later
 * validation fails, the created entry is left in place because a portable
 * pathname unlink cannot be atomic with a preceding identity check.
 */
export async function writeTextFileInsideProject(
  path: string,
  projectRoot: string,
  content: string,
  { allowMissing = false, expectedIdentity, expectedContent, requireMissing = false, rootIdentity }:
    {
      allowMissing?: boolean;
      expectedIdentity?: StableFileIdentity;
      expectedContent?: string;
      requireMissing?: boolean;
      rootIdentity?: PinnedDirectoryIdentity;
    } = {},
): Promise<void> {
  await assertPathInsideProject(path, projectRoot, { allowMissing });
  await writeTextFileInsideProjectWithNativeHandle(
    path,
    projectRoot,
    content,
    expectedIdentity,
    expectedContent,
    allowMissing,
    requireMissing,
    rootIdentity,
  );
}

async function readTextFileInsideProject(
  path: string,
  projectRoot: string,
  rootIdentity?: PinnedDirectoryIdentity,
): Promise<{ text: string; identity: StableFileIdentity }> {
  const file = await openProjectFile(path, projectRoot, "r", rootIdentity);
  try {
    const identity = stableFileIdentity(await file.stat({ bigint: true }));
    await assertPathInsideProject(path, projectRoot);
    if (!sameFileIdentity(identity, await pathFileIdentity(path, projectRoot, rootIdentity))) {
      throw new SafeFileGuardError("A file changed while it was being opened.");
    }
    const text = await file.readFile({ encoding: "utf8" });
    await assertPathInsideProject(path, projectRoot);
    if (!sameFileIdentity(identity, await pathFileIdentity(path, projectRoot, rootIdentity))) {
      throw new SafeFileGuardError("A file changed while it was being read.");
    }
    return { text, identity };
  } finally {
    await file.close();
  }
}

/**
 * Name a filesystem failure without echoing the path it carries.
 *
 * Runtime errors embed the absolute path they failed on, and this text reaches
 * the JSON report, so keep the error code or class and drop the message body.
 */
function describeFileError(error: unknown): string {
  if (error instanceof SafeFileGuardError) return error.message;
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string") return code;
  if (error instanceof Error) return error.name;
  return "unknown error";
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
  rootIdentity?: PinnedDirectoryIdentity,
): Promise<PackageJsonReadResult> {
  if (projectRoot !== undefined) {
    try {
      await assertPathInsideProject(path, projectRoot, { allowMissing: true });
    } catch {
      return {
        data: {},
        existingDeps: {},
        otherFieldDeps: {},
        parseError:
          "package.json could not be read safely; check that it is a stable regular file, not a symlink.",
      };
    }
  }
  let text: string;
  let fileIdentity: StableFileIdentity | undefined;
  try {
    if (projectRoot === undefined) {
      text = await Deno.readTextFile(path);
    } else {
      const opened = await readTextFileInsideProject(path, projectRoot, rootIdentity);
      text = opened.text;
      fileIdentity = opened.identity;
    }
  } catch (e) {
    if (isNotFoundError(e)) {
      // File does not exist, treat as absent and start with empty deps.
      return {
        data: {},
        existingDeps: {},
        otherFieldDeps: {},
        parseError: null,
        missingAtRead: true,
      };
    }
    // Any other error (permission denied, I/O failure, etc.) must not be
    // silently treated as "absent", which would risk overwriting a file we
    // could not safely read.  Report the failure kind so a permission or I/O
    // error is not misdiagnosed as a symlink.
    return {
      data: {},
      existingDeps: {},
      otherFieldDeps: {},
      parseError: `package.json could not be read: ${describeFileError(e)}.`,
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
    return {
      data,
      existingDeps,
      otherFieldDeps,
      parseError: null,
      ...(fileIdentity ? { fileIdentity } : {}),
      sourceText: text,
    };
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
          "The task enables native directory handles with --allow-ffi for safe traversal.\n" +
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

/**
 * Collect the source files under `dir`.
 *
 * `readDir` is injectable so the symlink skip can be exercised directly: the
 * skip must not depend on the runtime declining to classify a link as a file.
 */
async function assertDirectoryInsideProject(
  path: string,
  projectRoot: string,
  expectedIdentity?: StableFileIdentity,
): Promise<StableFileIdentity> {
  const info = await lstatNativeFile(path, { bigint: true });
  if (info.isSymbolicLink()) {
    throw new SafeFileGuardError("Refusing to traverse a symlinked directory.");
  }
  if (!info.isDirectory()) {
    throw new SafeFileGuardError("Refusing to traverse a path that is not a directory.");
  }
  const identity = stableFileIdentity(info);
  if (expectedIdentity && !sameFileIdentity(expectedIdentity, identity)) {
    throw new SafeFileGuardError("Refusing to traverse a directory that changed.");
  }
  const real = await Deno.realPath(path);
  const prefix = containmentPrefix(projectRoot);
  if (real !== projectRoot && !real.startsWith(prefix)) {
    throw new SafeFileGuardError("Refusing to traverse a directory outside the project.");
  }
  return identity;
}

export async function collectSourceFiles(
  dir: string,
  files: string[],
  readDir?: (path: string) => AsyncIterable<Deno.DirEntry>,
  projectRoot?: string,
  rootIdentity?: PinnedDirectoryIdentity,
): Promise<void> {
  const root = projectRoot ?? await Deno.realPath(dir);
  const pinnedRoot = rootIdentity ?? capturePinnedDirectoryIdentity(root);
  const directoryIdentity = await assertDirectoryInsideProject(dir, root);
  const entries: Deno.DirEntry[] = [];
  const directory = await Deno.realPath(dir);
  const entriesForDirectory = readDir
    ? readDir(dir)
    : readPinnedDirectory(directory, root, pinnedRoot);
  for await (const entry of entriesForDirectory) entries.push(entry);
  await assertDirectoryInsideProject(dir, root, directoryIdentity);

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    // Never traverse or collect symlinks: a link to a file or directory
    // outside the project must not be rewritten through the link.
    if (entry.isSymlink) continue;
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory) {
      await collectSourceFiles(path, files, readDir, root, pinnedRoot);
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

/** Join a caller-spelled project root to a normalized report path. */
export function joinReportPath(
  displayRoot: string,
  normalizedRelative: string,
  windows = Deno.build.os === "windows",
): string {
  if (!normalizedRelative) return displayRoot;
  // `C:` is drive-relative on Windows. Inserting a slash changes it into the
  // drive root (`C:/`) and reports a different file from the one traversed.
  if (windows && /^[A-Za-z]:$/.test(displayRoot)) {
    return `${displayRoot}${normalizedRelative}`;
  }
  const endsWithSeparator = windows ? /[/\\]$/ : /\/$/;
  return endsWithSeparator.test(displayRoot)
    ? `${displayRoot}${normalizedRelative}`
    : `${displayRoot}/${normalizedRelative}`;
}

async function main(args: string[]): Promise<void> {
  const { projectDir, dryRun, failOnConflict } = parseCliOptions(args);

  // Resolve the project root once so every subsequent containment check
  // compares against a symlink-free absolute path.
  const projectRoot = await Deno.realPath(projectDir);
  const projectRootIdentity = capturePinnedDirectoryIdentity(projectRoot);
  // Traversal and writes use the resolved root, but the report keeps the
  // spelling the caller passed: a relative project directory stays relative,
  // and no machine-specific filesystem layout leaks into the JSON output.
  const trailingSeparators = Deno.build.os === "windows" ? /[/\\]+$/ : /\/+$/;
  const displayRoot = projectDir === parsePath(projectDir).root
    ? projectDir
    : projectDir.replace(trailingSeparators, "") || projectDir;
  const toReportPath = (absolute: string): string => {
    const projectRelative = relative(projectRoot, absolute);
    if (
      isAbsolute(projectRelative) || projectRelative === ".." ||
      projectRelative.startsWith(`..${PATH_SEPARATOR}`)
    ) {
      throw new Error("Refusing to report a path outside the project directory");
    }
    const normalizedRelative = Deno.build.os === "windows"
      ? projectRelative.replaceAll("\\", "/")
      : projectRelative;
    return joinReportPath(displayRoot, normalizedRelative);
  };

  const sourceFiles: string[] = [];
  try {
    await collectSourceFiles(
      projectRoot,
      sourceFiles,
      undefined,
      projectRoot,
      projectRootIdentity,
    );
  } catch (error) {
    throw new Error(`Failed to scan ${displayRoot} safely: ${describeFileError(error)}`, {
      cause: error,
    });
  }
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
  const analyzedFiles: Array<{
    file: string;
    source: string;
    identity: StableFileIdentity;
    result: EsmShFileResult;
  }> = [];

  for (const file of sourceFiles) {
    const reportFile = toReportPath(file);
    let source: string;
    let identity: StableFileIdentity;
    try {
      const opened = await readTextFileInsideProject(file, projectRoot, projectRootIdentity);
      source = opened.text;
      identity = opened.identity;
    } catch (error) {
      throw new Error(`Failed to read ${reportFile} safely: ${describeFileError(error)}`, {
        cause: error,
      });
    }
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

    analyzedFiles.push({ file, source, identity, result });
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
    fileIdentity: pkgJsonFileIdentity,
    sourceText: pkgJsonSource,
    missingAtRead: pkgJsonMissingAtRead,
  } = await readProjectPackageJson(pkgJsonPath, projectRoot, projectRootIdentity);

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
  const fileResults: Array<{
    file: string;
    source: string;
    code: string;
    identity: StableFileIdentity;
  }> = [];
  for (const { file, source, identity, result: analyzedResult } of analyzedFiles) {
    const result = conflictedPackages.size === 0
      ? analyzedResult
      : transformEsmShImports(source, conflictedPackages);
    if (!result.changed) continue;

    fileResults.push({ file, source, code: result.code, identity });
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
      try {
        await writeTextFileInsideProject(
          pkgJsonPath,
          projectRoot,
          JSON.stringify(pkgJson, null, 2) + "\n",
          {
            allowMissing: pkgJsonMissingAtRead === true,
            expectedIdentity: pkgJsonFileIdentity,
            expectedContent: pkgJsonSource,
            requireMissing: pkgJsonMissingAtRead,
            rootIdentity: projectRootIdentity,
          },
        );
      } catch (error) {
        throw new Error(
          `Failed to write ${toReportPath(pkgJsonPath)} safely: ${describeFileError(error)}`,
          { cause: error },
        );
      }
    } else if (fileResults.length > 0 && pkgJsonFileIdentity && pkgJsonSource !== undefined) {
      // Matching pins still authorize the source rewrite. Revalidate their
      // analyzed snapshot even when the manifest itself needs no update.
      let current: Awaited<ReturnType<typeof readTextFileInsideProject>>;
      try {
        current = await readTextFileInsideProject(
          pkgJsonPath,
          projectRoot,
          projectRootIdentity,
        );
      } catch (error) {
        throw new SafeFileGuardError(
          "Refusing to rewrite source files because package.json could not be revalidated safely.",
          { cause: error },
        );
      }
      if (
        !sameFileIdentity(pkgJsonFileIdentity, current.identity) || current.text !== pkgJsonSource
      ) {
        throw new SafeFileGuardError(
          "Refusing to rewrite source files because package.json changed after analysis.",
        );
      }
    }

    for (const { file, source, code, identity } of fileResults) {
      try {
        await writeTextFileInsideProject(file, projectRoot, code, {
          expectedIdentity: identity,
          expectedContent: source,
          rootIdentity: projectRootIdentity,
        });
      } catch (error) {
        throw new Error(
          `Failed to write ${toReportPath(file)} safely: ${describeFileError(error)}`,
          {
            cause: error,
          },
        );
      }
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

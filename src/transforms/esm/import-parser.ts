import { compileContent } from "#veryfront/transforms/mdx/compiler/index.ts";
import { getEsbuild } from "#veryfront/platform/compat/esbuild.ts";
import {
  dirname,
  fromFileUrl,
  join,
  normalize,
  posix,
  relative,
  resolve,
} from "#veryfront/compat/path";
import { computeHash } from "#veryfront/utils/hash-utils.ts";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import { createFileSystem, realPath } from "#veryfront/platform/compat/fs.ts";
import {
  isFrameworkSourcePath,
  resolveRelativeFrameworkSourceImport,
} from "#veryfront/platform/compat/framework-source-resolver.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { isCrossProjectImport, parseCrossProjectImport } from "./path-resolver.ts";
import { parseImports } from "./lexer.ts";
import { getLoaderFromPath } from "./transform-utils.ts";
import { isCanonicalNotFoundError } from "#veryfront/platform/compat/not-found-error.ts";
import { isNativeErrorWithoutHooks } from "#veryfront/platform/compat/error-introspection.ts";
import { isWindowsPlatform } from "#veryfront/platform/compat/process/runtime-process.ts";

export interface LocalImport {
  specifier: string;
  /** Exact specifier present in transformed code when it differs from authored source. */
  rewriteSpecifier?: string;
  absolutePath: string;
  /** Lexical project path the author addressed, used for metadata and CSS identity. */
  requestedPath?: string;
  /** Lexical filename selected by extension or directory-index resolution. */
  resolvedPath?: string;
  /** True when canonical project containment approved absolutePath. */
  projectContained?: true;
}

export interface CrossProjectImport {
  specifier: string;
  projectSlug: string;
  version: string;
  path: string;
}

export interface MissingImport {
  specifier: string;
  fromFile: string;
  reason: string;
}

interface ParseLocalImportsResult {
  imports: LocalImport[];
  cssImports: LocalImport[];
  crossProjectImports: CrossProjectImport[];
  missing: MissingImport[];
}

const EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".mdx"];
const HAS_EXTENSION_RE = /\.(tsx?|jsx?|mjs|cjs|mdx|css)$/;

// Tenant SSR code executes in this realm before later parses run, so the
// containment decision must not dispatch through mutable prototype methods or
// inherited adapter properties. Capture the intrinsics it depends on at module
// initialization, as the path compatibility layer does for its own operations.
const ReflectApply = Reflect.apply;
const ArrayJoin = Array.prototype.join;
const ArrayPush = Array.prototype.push;
const PromiseConstructor = Promise;
const PromiseAll = Promise.all;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ObjectGetPrototypeOf = Object.getPrototypeOf;
const SymbolIterator: typeof Symbol.iterator = Symbol.iterator;
const universalObjectPrototype = Object.prototype;
const RegExpTest = RegExp.prototype.test;
const StringEndsWith = String.prototype.endsWith;
const StringLastIndexOf = String.prototype.lastIndexOf;
const StringReplace = String.prototype.replace;
const StringReplaceAll = String.prototype.replaceAll;
const StringSlice = String.prototype.slice;
const StringStartsWith = String.prototype.startsWith;
const windowsHost = isWindowsPlatform();

/**
 * Records a parse result through the captured push intrinsic. Which imports a
 * parse reports is a security decision: a replaced Array.prototype.push that
 * selectively drops an approved dependency would leave the compiled parent's
 * original `file://` import without a bound read or rewrite entry.
 */
function arrayPush<T>(target: T[], value: T): void {
  ReflectApply(ArrayPush, target, [value]);
}

function arrayJoin(values: readonly string[], separator: string): string {
  return ReflectApply(ArrayJoin, values, [separator]) as string;
}

function regExpTest(pattern: RegExp, value: string): boolean {
  return ReflectApply(RegExpTest, pattern, [value]) as boolean;
}

function stringEndsWith(value: string, search: string): boolean {
  return ReflectApply(StringEndsWith, value, [search]) as boolean;
}

function stringLastIndexOf(value: string, search: string): number {
  return ReflectApply(StringLastIndexOf, value, [search]) as number;
}

function stringReplaceAll(value: string, search: string, replacement: string): string {
  return ReflectApply(StringReplaceAll, value, [search, replacement]) as string;
}

function stringReplace(value: string, search: string | RegExp, replacement: string): string {
  return ReflectApply(StringReplace, value, [search, replacement]) as string;
}

function stringSlice(value: string, start: number, end?: number): string {
  return ReflectApply(StringSlice, value, end === undefined ? [start] : [start, end]) as string;
}

function stringStartsWith(value: string, search: string): boolean {
  return ReflectApply(StringStartsWith, value, [search]) as boolean;
}

function isDriveRootedPath(path: string): boolean {
  const first = path[0];
  return path[1] === ":" && path[2] === "/" &&
    ((first !== undefined && first >= "A" && first <= "Z") ||
      (first !== undefined && first >= "a" && first <= "z"));
}

function normalizeProjectRoot(projectDir: string): string {
  if (projectDir === "") return "/";
  return windowsHost || isDriveRootedPath(projectDir)
    ? normalize(projectDir)
    : posix.normalize(projectDir);
}

function joinProjectPath(root: string, path: string): string {
  return windowsHost || isDriveRootedPath(root) ? join(root, path) : posix.join(root, path);
}

function isFileUrlSpecifier(value: string): boolean {
  return stringStartsWith(value, "file://");
}

function indexedIterable<T>(values: readonly T[]): Iterable<T> {
  return {
    [SymbolIterator]() {
      let index = 0;
      return {
        next(): IteratorResult<T> {
          if (index >= values.length) return { done: true, value: undefined };
          const value = values[index]!;
          index++;
          return { done: false, value };
        },
      };
    },
  };
}

function promiseAll<T>(values: readonly (T | PromiseLike<T>)[]): Promise<T[]> {
  return ReflectApply(PromiseAll, PromiseConstructor, [indexedIterable(values)]) as Promise<T[]>;
}

/**
 * Compiled MDX, keyed by project, file and content hash.
 *
 * Dependency parsing runs on every render, including every memory, Redis and
 * MDX-ESM cache hit, and recurses through the dependency tree. Without this the
 * full remark/rehype compile of every MDX file is paid again on each of them,
 * for a result that cannot change while the content does not.
 */
const COMPILED_MDX_CACHE_MAX_ENTRIES = 200;
const compiledMdxCache = new LRUCache<string, string>({
  maxEntries: COMPILED_MDX_CACHE_MAX_ENTRIES,
});

async function compileMdxForParsing(
  code: string,
  filePath: string,
  projectDir: string,
): Promise<string> {
  const cacheKey = `${projectDir}::${filePath}::${await computeHash(code)}`;
  const cached = compiledMdxCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const compiled = await compileContent(
    "development",
    projectDir,
    code,
    undefined,
    filePath,
    "server",
  );

  compiledMdxCache.set(cacheKey, compiled.compiledCode);
  return compiled.compiledCode;
}

export async function parseLocalImports(
  code: string,
  filePath: string,
  projectDir: string,
  adapter?: RuntimeAdapter,
): Promise<ParseLocalImportsResult> {
  // Markdown compiles to a fixed template whose only import is the bare JSX
  // runtime, which this parser discards, so the answer for a `.md` file is
  // always "no dependencies". Compiling one to learn that is pure cost on a
  // path that runs per render.
  if (
    stringEndsWith(filePath, ".css") || stringEndsWith(filePath, ".json") ||
    regExpTest(/\.md$/i, filePath)
  ) {
    return { imports: [], cssImports: [], crossProjectImports: [], missing: [] };
  }

  // MDX is not JSX, so handing the raw source to esbuild under the `jsx` loader
  // fails with "<stdin>:1:1: ERROR: Syntax error", which surfaced to users as
  // "Component has missing dependencies" for a file that exists. Compile
  // content to JSX first, exactly as the transform pipeline's parse stage does,
  // then read the imports out of that.
  let parseSource = code;
  if (regExpTest(/\.mdx$/i, filePath)) {
    parseSource = await compileMdxForParsing(code, filePath, projectDir);
  }

  const esbuild = await getEsbuild();
  const result = await esbuild.transform(parseSource, {
    loader: getLoaderFromPath(filePath),
    format: "esm",
    target: "esnext",
    jsx: "automatic",
    jsxImportSource: "react",
    minify: false,
    sourcemap: false,
    treeShaking: false,
    keepNames: true,
  });

  const imports = await parseImports(result.code);
  const localImports: LocalImport[] = [];
  const cssImports: LocalImport[] = [];
  const crossProjectImports: CrossProjectImport[] = [];
  const missingImports: MissingImport[] = [];
  const containment = createContainmentContext(projectDir, adapter);

  for (let importIndex = 0; importIndex < imports.length; importIndex++) {
    const imp = imports[importIndex]!;
    const specifier = imp.n;
    if (!specifier) continue;

    // The content compile above runs with the "server" target, which rewrites a
    // relative specifier to an absolute `file://` URL before the lexer ever
    // sees it. Without this branch those dependencies match none of the shapes
    // below and are dropped without even being reported as missing, so an MDX
    // file's sibling components are never recursively transformed.
    if (isFileUrlSpecifier(specifier)) {
      const targetPath = fileUrlToPath(specifier);
      // A rewritten specifier carries a server path the author never wrote, and
      // this record is read back verbatim in the "Component has missing
      // dependencies" build error. Report what the author wrote instead.
      const authoredSpecifier = toAuthoredSpecifier(targetPath, specifier, filePath);
      const resolved = targetPath ? await resolveContainedFilePath(targetPath, containment) : null;

      if (resolved) {
        const entry = {
          specifier: authoredSpecifier,
          rewriteSpecifier: specifier,
          absolutePath: resolved.absolutePath,
          requestedPath: resolved.requestedPath,
          resolvedPath: resolved.resolvedPath,
          projectContained: true as const,
        };
        // An in-project symlink may canonicalize to a target whose suffix
        // differs from the link's. The import keeps the type the author
        // addressed; the canonical path is only what gets read.
        if (stringEndsWith(resolved.requestedPath, ".css")) arrayPush(cssImports, entry);
        else arrayPush(localImports, entry);
        continue;
      }

      arrayPush(missingImports, {
        specifier: authoredSpecifier,
        fromFile: filePath,
        reason: `File not found: tried extensions ${arrayJoin(EXTENSIONS, ", ")}`,
      });
      continue;
    }

    if (stringStartsWith(specifier, "./") || stringStartsWith(specifier, "../")) {
      const resolved = await resolveLocalImportPath(filePath, specifier, adapter);
      if (resolved) {
        if (stringEndsWith(resolved, ".css")) {
          arrayPush(cssImports, { specifier, absolutePath: resolved });
        } else {
          arrayPush(localImports, { specifier, absolutePath: resolved });
        }
        continue;
      }

      arrayPush(missingImports, {
        specifier,
        fromFile: filePath,
        reason: `File not found: tried extensions ${arrayJoin(EXTENSIONS, ", ")}`,
      });
      continue;
    }

    if (stringStartsWith(specifier, "@/")) {
      const aliasPath = stringSlice(specifier, 2);
      const resolved = await resolveAliasImportPath(aliasPath, containment);
      if (resolved) {
        const entry = {
          specifier,
          absolutePath: resolved.absolutePath,
          requestedPath: resolved.requestedPath,
          resolvedPath: resolved.resolvedPath,
          projectContained: true as const,
        };
        if (stringEndsWith(resolved.requestedPath, ".css")) arrayPush(cssImports, entry);
        else arrayPush(localImports, entry);
        continue;
      }

      arrayPush(missingImports, {
        specifier,
        fromFile: filePath,
        reason: `Alias path not found: @/${aliasPath}`,
      });
      continue;
    }

    if (!isCrossProjectImport(specifier)) continue;

    const parsed = parseCrossProjectImport(specifier);
    if (!parsed) continue;

    arrayPush(crossProjectImports, {
      specifier,
      projectSlug: parsed.projectSlug,
      version: parsed.version,
      path: parsed.path,
    });
  }

  return { imports: localImports, cssImports, crossProjectImports, missing: missingImports };
}

function isPathWithinProject(path: string, projectDir: string): boolean {
  // This predicate is the containment decision, so it runs on captured string
  // intrinsics: tenant code that replaced String.prototype.replaceAll or
  // startsWith must not be able to make an escaping path look contained.
  const projectRelativePath = windowsHost
    ? stringReplaceAll(relative(projectDir, path), "\\", "/")
    : posix.relative(projectDir, path);
  const first = projectRelativePath[0];
  const driveQualified = windowsHost && projectRelativePath[1] === ":" &&
    projectRelativePath[2] === "/" &&
    ((first !== undefined && first >= "A" && first <= "Z") ||
      (first !== undefined && first >= "a" && first <= "z"));
  return projectRelativePath !== ".." &&
    !stringStartsWith(projectRelativePath, "../") &&
    !stringStartsWith(projectRelativePath, "/") &&
    !driveQualified;
}

/** @internal Test seams for portable containment rules. */
export const importParserInternals = Object.freeze({
  isFileUrlSpecifier,
  isPathWithinProject,
  fileUrlToPath,
  resolveRelative,
  toAuthoredSpecifier,
});

/**
 * Everything one parse needs to decide containment, captured once per parse:
 * the normalized project root, the adapter's own symlink-free contract, the
 * canonicalization capability, and a shared canonical project root so accepted
 * imports do not repeat `realPath(projectDir)` per dependency per render.
 */
interface ContainmentContext {
  readonly projectDir: string;
  readonly adapter?: RuntimeAdapter;
  readonly symlinkFree: boolean;
  readonly canonicalize: ((path: string) => Promise<string>) | null;
  canonicalProjectDir(): Promise<string>;
}

function createContainmentContext(
  projectDir: string,
  adapter?: RuntimeAdapter,
): ContainmentContext {
  // Strip trailing separators but preserve filesystem roots without changing
  // path flavor: "/" must not become "" (which realPath rejects), a portable
  // Windows drive root such as "C:/" must not become the drive-relative "C:",
  // and a POSIX root containing "\" must keep that filename character.
  const normalizedProjectDir = normalizeProjectRoot(projectDir);
  const fs = adapter?.fs;
  // Symlink-free semantics are authority, so only an own data property
  // counts, exactly as FSAdapterWrapper captures it: an inherited value (for
  // example Object.prototype pollution with "none") must not switch the
  // canonical check off.
  const semantics = fs === undefined
    ? undefined
    : ObjectGetOwnPropertyDescriptor(fs, "symlinkSemantics");
  const symlinkFree = semantics !== undefined && "value" in semantics &&
    semantics.value === "none";
  const realPathMethod = fs === undefined ? undefined : captureRealPath(fs);
  let canonicalize: ((path: string) => Promise<string>) | null;
  if (realPathMethod !== undefined) {
    canonicalize = (path: string) => ReflectApply(realPathMethod, fs, [path]) as Promise<string>;
  } else {
    canonicalize = adapter === undefined ? realPath : null;
  }
  let canonicalRoot: Promise<string> | undefined;
  return {
    projectDir: normalizedProjectDir,
    adapter,
    symlinkFree,
    canonicalize,
    canonicalProjectDir(): Promise<string> {
      canonicalRoot ??= canonicalize!(normalizedProjectDir);
      return canonicalRoot;
    },
  };
}

/**
 * The adapter's realPath as a data property from its own prototype chain.
 * Canonicalization is authority, so a value inherited from Object.prototype
 * (pollution) or served by an accessor is never used; absence fails closed in
 * the caller. Captured once per parse instead of being looked up per import.
 */
function captureRealPath(
  fs: RuntimeAdapter["fs"],
): ((path: string) => Promise<string>) | undefined {
  let owner: object | null = fs;
  for (let depth = 0; owner !== null && depth < 64; depth++) {
    if (owner === universalObjectPrototype) return undefined;
    const descriptor = ObjectGetOwnPropertyDescriptor(owner, "realPath");
    if (descriptor !== undefined) {
      return "value" in descriptor && typeof descriptor.value === "function"
        ? descriptor.value as (path: string) => Promise<string>
        : undefined;
    }
    owner = ObjectGetPrototypeOf(owner);
  }
  return undefined;
}

interface ContainedImportPath {
  /** Canonical path callers must record and later read. */
  absolutePath: string;
  /** Lexically resolved path naming what the author addressed. */
  requestedPath: string;
  /** Existing lexical filename after extension and directory-index probing. */
  resolvedPath: string;
}

async function resolveContainedFilePath(
  targetPath: string,
  containment: ContainmentContext,
): Promise<ContainedImportPath | null> {
  if (!isPathWithinProject(targetPath, containment.projectDir)) return null;

  const resolved = await resolveExistingFilePath(targetPath, containment.adapter);
  if (!resolved) return null;
  return await toContainedImportPath(resolved, containment, targetPath);
}

/**
 * The canonical (symlink-free) form of `resolved` paired with the requested
 * path, or null when the canonical form escapes the project. The canonical
 * path is what callers must record and later read: returning the lexical path
 * instead would let a symlink retargeted between this check and the eventual
 * `readFile` escape containment (TOCTOU). The requested path travels with it
 * because it, not the link target's name, says whether the author imported a
 * stylesheet or a module.
 */
async function toContainedImportPath(
  resolved: string,
  containment: ContainmentContext,
  requestedPath = resolved,
): Promise<ContainedImportPath | null> {
  if (containment.symlinkFree) {
    // Hosted adapters return paths in their project-relative namespace. Check
    // that namespace against the already-approved project root, but preserve
    // the adapter path for its later read.
    if (!isPathWithinProject(resolve(containment.projectDir, resolved), containment.projectDir)) {
      return null;
    }
    return {
      absolutePath: resolved,
      requestedPath,
      resolvedPath: resolve(containment.projectDir, resolved),
    };
  }
  if (containment.canonicalize === null) return null;

  let canonicalPaths: string[];
  try {
    canonicalPaths = await promiseAll([
      containment.canonicalProjectDir(),
      containment.canonicalize(resolved),
    ]);
  } catch (error) {
    if (isExpectedCanonicalizationRace(error)) return null;
    throw error;
  }
  const canonicalProjectDir = canonicalPaths[0]!;
  const canonicalResolved = canonicalPaths[1]!;
  if (!isPathWithinProject(canonicalResolved, canonicalProjectDir)) return null;
  return { absolutePath: canonicalResolved, requestedPath, resolvedPath: resolved };
}

function isExpectedCanonicalizationRace(error: unknown): boolean {
  if (isCanonicalNotFoundError(error)) return true;
  if (!isNativeErrorWithoutHooks(error)) return false;
  const code = ObjectGetOwnPropertyDescriptor(error, "code");
  return code !== undefined && "value" in code && code.value === "ELOOP";
}

/**
 * The specifier as the author most likely wrote it, reconstructed from the
 * absolute path a compile step rewrote it to. Falls back to the file name when
 * the URL cannot be read, so no server path escapes into a user-facing report.
 */
function toAuthoredSpecifier(
  targetPath: string | null,
  specifier: string,
  fromFile: string,
): string {
  if (!targetPath) {
    return `./${stringSlice(specifier, stringLastIndexOf(specifier, "/") + 1)}`;
  }

  const relativePath = relative(dirname(fromFile), targetPath);
  return stringStartsWith(relativePath, ".") ? relativePath : `./${relativePath}`;
}

/** Filesystem path behind a `file://` specifier, or null when it is not one. */
function fileUrlToPath(specifier: string): string | null {
  try {
    const url = new URL(specifier);
    if (url.protocol !== "file:") return null;
    // The rest of the transform graph uses portable slash-separated paths.
    // `fromFileUrl()` returns native backslashes on Windows, and retaining
    // those in requestedPath makes recursive relative imports resolve from
    // the filesystem root instead of the dependency's directory.
    const path = fromFileUrl(url);
    return windowsHost ? stringReplaceAll(path, "\\", "/") : path;
  } catch (_) {
    /* expected: not a well-formed URL */
    return null;
  }
}

async function checkFileExists(path: string, adapter?: RuntimeAdapter): Promise<boolean> {
  try {
    const fs = adapter?.fs.stat ? adapter.fs : createFileSystem();
    const stat = await fs.stat(path);
    return stat.isFile;
  } catch (_) {
    /* expected: file may not exist */
    return false;
  }
}

async function resolveLocalImportPath(
  fromFile: string,
  importSpecifier: string,
  adapter?: RuntimeAdapter,
): Promise<string | null> {
  if (isFrameworkSourcePath(fromFile)) {
    const resolvedFrameworkImport = await resolveRelativeFrameworkSourceImport(
      importSpecifier,
      fromFile,
    );
    if (resolvedFrameworkImport) return resolvedFrameworkImport;
  }

  const lastSeparator = stringLastIndexOf(fromFile, "/");
  const fromDir = stringSlice(fromFile, 0, lastSeparator < 0 ? 0 : lastSeparator);
  return await resolveExistingFilePath(resolveRelative(fromDir, importSpecifier), adapter);
}

/**
 * Path of the file a local import points at: the adapter's own resolution
 * first, then the extension and directory-index probes. Every local import
 * shape resolves through here, so an extensionless or directory specifier
 * behaves the same however it reached this module.
 */
async function resolveExistingFilePath(
  basePath: string,
  adapter?: RuntimeAdapter,
): Promise<string | null> {
  if (adapter?.fs.resolveFile) {
    try {
      const normalizedPath = stringReplace(basePath, /^\/+/, "");
      const resolved = await adapter.fs.resolveFile(normalizedPath);
      if (resolved) return resolved;
    } catch (_) {
      /* expected: resolveFile may not be supported */
      // Fall through to traditional resolution
    }
  }

  if (regExpTest(HAS_EXTENSION_RE, basePath)) {
    return (await checkFileExists(basePath, adapter)) ? basePath : null;
  }

  for (let extensionIndex = 0; extensionIndex < EXTENSIONS.length; extensionIndex++) {
    const candidate = basePath + EXTENSIONS[extensionIndex]!;
    if (await checkFileExists(candidate, adapter)) return candidate;
  }

  for (let extensionIndex = 0; extensionIndex < EXTENSIONS.length; extensionIndex++) {
    const candidate = `${basePath}/index${EXTENSIONS[extensionIndex]!}`;
    if (await checkFileExists(candidate, adapter)) return candidate;
  }

  return null;
}

async function resolveAliasImportPath(
  basePath: string,
  containment: ContainmentContext,
): Promise<ContainedImportPath | null> {
  const normalizedPath = stringReplace(basePath, /^\/+/, "");
  const lexicalPath = joinProjectPath(containment.projectDir, normalizedPath);
  if (!isPathWithinProject(lexicalPath, containment.projectDir)) return null;

  const adapter = containment.adapter;
  if (adapter?.fs.resolveFile) {
    try {
      const resolved = await adapter.fs.resolveFile(normalizedPath);
      if (resolved) {
        return await toContainedImportPath(
          resolved,
          containment,
          containment.symlinkFree ? resolve(containment.projectDir, resolved) : resolved,
        );
      }
    } catch (_) {
      /* expected: resolveFile may not be supported */
      // Fall through to manual resolution
    }
  }

  if (regExpTest(HAS_EXTENSION_RE, normalizedPath)) {
    return await resolveContainedFilePath(lexicalPath, containment);
  }

  const candidates: string[] = [];
  for (let extensionIndex = 0; extensionIndex < EXTENSIONS.length; extensionIndex++) {
    arrayPush(
      candidates,
      joinProjectPath(containment.projectDir, normalizedPath + EXTENSIONS[extensionIndex]!),
    );
  }
  for (let extensionIndex = 0; extensionIndex < EXTENSIONS.length; extensionIndex++) {
    arrayPush(
      candidates,
      joinProjectPath(
        joinProjectPath(containment.projectDir, normalizedPath),
        "index" + EXTENSIONS[extensionIndex]!,
      ),
    );
  }

  const resolved = await findFirstExistingFile(candidates, createFileSystem());
  if (!resolved) return null;
  return await toContainedImportPath(resolved, containment);
}

async function findFirstExistingFile(
  paths: string[],
  fs: ReturnType<typeof createFileSystem>,
): Promise<string | null> {
  const pending: Array<Promise<string | null>> = [];
  for (let pathIndex = 0; pathIndex < paths.length; pathIndex++) {
    const path = paths[pathIndex]!;
    arrayPush(
      pending,
      (async () => {
        try {
          const stat = await fs.stat(path);
          return stat.isFile ? path : null;
        } catch (_) {
          /* expected: file may not exist */
          return null;
        }
      })(),
    );
  }
  const results = await promiseAll(pending);

  for (let resultIndex = 0; resultIndex < results.length; resultIndex++) {
    const result = results[resultIndex];
    if (result !== null && result !== undefined) return result;
  }
  return null;
}

function resolveRelative(fromDir: string, importPath: string): string {
  return windowsHost || isDriveRootedPath(fromDir)
    ? resolve(fromDir, importPath)
    : posix.resolve(fromDir, importPath);
}

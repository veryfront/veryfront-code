import { compileContent } from "#veryfront/transforms/mdx/compiler/index.ts";
import { getEsbuild } from "#veryfront/platform/compat/esbuild.ts";
import { dirname, join, normalize, relative } from "#veryfront/compat/path";
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

export interface LocalImport {
  specifier: string;
  absolutePath: string;
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
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ObjectGetPrototypeOf = Object.getPrototypeOf;
const universalObjectPrototype = Object.prototype;
const StringReplaceAll = String.prototype.replaceAll;
const StringStartsWith = String.prototype.startsWith;

function stringReplaceAll(value: string, search: string, replacement: string): string {
  return ReflectApply(StringReplaceAll, value, [search, replacement]) as string;
}

function stringStartsWith(value: string, search: string): boolean {
  return ReflectApply(StringStartsWith, value, [search]) as boolean;
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
  if (filePath.endsWith(".css") || filePath.endsWith(".json") || /\.md$/i.test(filePath)) {
    return { imports: [], cssImports: [], crossProjectImports: [], missing: [] };
  }

  // MDX is not JSX, so handing the raw source to esbuild under the `jsx` loader
  // fails with "<stdin>:1:1: ERROR: Syntax error", which surfaced to users as
  // "Component has missing dependencies" for a file that exists. Compile
  // content to JSX first, exactly as the transform pipeline's parse stage does,
  // then read the imports out of that.
  let parseSource = code;
  if (/\.mdx$/i.test(filePath)) {
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

  for (const imp of imports) {
    const specifier = imp.n;
    if (!specifier) continue;

    // The content compile above runs with the "server" target, which rewrites a
    // relative specifier to an absolute `file://` URL before the lexer ever
    // sees it. Without this branch those dependencies match none of the shapes
    // below and are dropped without even being reported as missing, so an MDX
    // file's sibling components are never recursively transformed.
    if (specifier.startsWith("file://")) {
      const targetPath = fileUrlToPath(specifier);
      // A rewritten specifier carries a server path the author never wrote, and
      // this record is read back verbatim in the "Component has missing
      // dependencies" build error. Report what the author wrote instead.
      const authoredSpecifier = toAuthoredSpecifier(targetPath, specifier, filePath);
      const resolved = targetPath ? await resolveContainedFilePath(targetPath, containment) : null;

      if (resolved) {
        const entry = { specifier: authoredSpecifier, absolutePath: resolved.absolutePath };
        // An in-project symlink may canonicalize to a target whose suffix
        // differs from the link's. The import keeps the type the author
        // addressed; the canonical path is only what gets read.
        if (resolved.requestedPath.endsWith(".css")) cssImports.push(entry);
        else localImports.push(entry);
        continue;
      }

      missingImports.push({
        specifier: authoredSpecifier,
        fromFile: filePath,
        reason: `File not found: tried extensions ${EXTENSIONS.join(", ")}`,
      });
      continue;
    }

    if (specifier.startsWith("./") || specifier.startsWith("../")) {
      const resolved = await resolveLocalImportPath(filePath, specifier, adapter);
      if (resolved) {
        if (resolved.endsWith(".css")) {
          cssImports.push({ specifier, absolutePath: resolved });
        } else {
          localImports.push({ specifier, absolutePath: resolved });
        }
        continue;
      }

      missingImports.push({
        specifier,
        fromFile: filePath,
        reason: `File not found: tried extensions ${EXTENSIONS.join(", ")}`,
      });
      continue;
    }

    if (specifier.startsWith("@/")) {
      const aliasPath = specifier.slice(2);
      const resolved = await resolveAliasImportPath(aliasPath, containment);
      if (resolved) {
        const entry = { specifier, absolutePath: resolved.absolutePath };
        if (resolved.requestedPath.endsWith(".css")) cssImports.push(entry);
        else localImports.push(entry);
        continue;
      }

      missingImports.push({
        specifier,
        fromFile: filePath,
        reason: `Alias path not found: @/${aliasPath}`,
      });
      continue;
    }

    if (!isCrossProjectImport(specifier)) continue;

    const parsed = parseCrossProjectImport(specifier);
    if (!parsed) continue;

    crossProjectImports.push({
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
  const projectRelativePath = stringReplaceAll(relative(projectDir, path), "\\", "/");
  return projectRelativePath !== ".." &&
    !stringStartsWith(projectRelativePath, "../") &&
    !stringStartsWith(projectRelativePath, "/");
}

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
  // Strip trailing separators but preserve filesystem roots: "/" must not
  // become "" (which realPath rejects) and a portable Windows drive root such
  // as "C:/" must not become the drive-relative "C:". The path facade's
  // normalize implements exactly that contract on captured intrinsics.
  const normalizedProjectDir = projectDir === "" ? "/" : normalize(projectDir);
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
  const canonicalize = realPathMethod !== undefined
    ? (path: string) => ReflectApply(realPathMethod, fs, [path]) as Promise<string>
    : adapter === undefined
    ? realPath
    : null;
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
  fs: object,
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
}

async function resolveContainedFilePath(
  targetPath: string,
  containment: ContainmentContext,
): Promise<ContainedImportPath | null> {
  if (!isPathWithinProject(targetPath, containment.projectDir)) return null;

  const resolved = await resolveExistingFilePath(targetPath, containment.adapter);
  if (!resolved) return null;
  return await toContainedImportPath(resolved, containment);
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
): Promise<ContainedImportPath | null> {
  if (containment.symlinkFree) {
    return { absolutePath: resolved, requestedPath: resolved };
  }
  if (containment.canonicalize === null) return null;

  const [canonicalProjectDir, canonicalResolved] = await Promise.all([
    containment.canonicalProjectDir(),
    containment.canonicalize(resolved),
  ]);
  if (!isPathWithinProject(canonicalResolved, canonicalProjectDir)) return null;
  return { absolutePath: canonicalResolved, requestedPath: resolved };
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
  if (!targetPath) return `./${specifier.slice(specifier.lastIndexOf("/") + 1)}`;

  const relativePath = relative(dirname(fromFile), targetPath);
  return relativePath.startsWith(".") ? relativePath : `./${relativePath}`;
}

/** Filesystem path behind a `file://` specifier, or null when it is not one. */
function fileUrlToPath(specifier: string): string | null {
  try {
    const url = new URL(specifier);
    if (url.protocol !== "file:") return null;
    return decodeURIComponent(url.pathname);
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

  const fromDir = fromFile.substring(0, fromFile.lastIndexOf("/"));
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
      const normalizedPath = basePath.replace(/^\/+/, "");
      const resolved = await adapter.fs.resolveFile(normalizedPath);
      if (resolved) return resolved;
    } catch (_) {
      /* expected: resolveFile may not be supported */
      // Fall through to traditional resolution
    }
  }

  if (HAS_EXTENSION_RE.test(basePath)) {
    return (await checkFileExists(basePath, adapter)) ? basePath : null;
  }

  for (const ext of EXTENSIONS) {
    const candidate = basePath + ext;
    if (await checkFileExists(candidate, adapter)) return candidate;
  }

  for (const ext of EXTENSIONS) {
    const candidate = `${basePath}/index${ext}`;
    if (await checkFileExists(candidate, adapter)) return candidate;
  }

  return null;
}

async function resolveAliasImportPath(
  basePath: string,
  containment: ContainmentContext,
): Promise<ContainedImportPath | null> {
  const normalizedPath = basePath.replace(/^\/+/, "");
  const lexicalPath = join(containment.projectDir, normalizedPath);
  if (!isPathWithinProject(lexicalPath, containment.projectDir)) return null;

  const adapter = containment.adapter;
  if (adapter?.fs.resolveFile) {
    try {
      const resolved = await adapter.fs.resolveFile(normalizedPath);
      if (resolved) return await toContainedImportPath(resolved, containment);
    } catch (_) {
      /* expected: resolveFile may not be supported */
      // Fall through to manual resolution
    }
  }

  if (HAS_EXTENSION_RE.test(normalizedPath)) {
    return await resolveContainedFilePath(lexicalPath, containment);
  }

  const candidates = [
    ...EXTENSIONS.map((ext) => join(containment.projectDir, normalizedPath + ext)),
    ...EXTENSIONS.map((ext) => join(containment.projectDir, normalizedPath, "index" + ext)),
  ];

  const resolved = await findFirstExistingFile(candidates, createFileSystem());
  if (!resolved) return null;
  return await toContainedImportPath(resolved, containment);
}

async function findFirstExistingFile(
  paths: string[],
  fs: ReturnType<typeof createFileSystem>,
): Promise<string | null> {
  const results = await Promise.all(
    paths.map(async (path) => {
      try {
        const stat = await fs.stat(path);
        return stat.isFile ? path : null;
      } catch (_) {
        /* expected: file may not exist */
        return null;
      }
    }),
  );

  return results.find((r) => r !== null) ?? null;
}

function resolveRelative(fromDir: string, importPath: string): string {
  const parts = fromDir.split("/").filter(Boolean);
  const importParts = importPath.split("/").filter(Boolean);

  for (const part of importParts) {
    if (part === "..") {
      parts.pop();
      continue;
    }
    if (part !== ".") parts.push(part);
  }

  return "/" + parts.join("/");
}

import { compileContent } from "#veryfront/transforms/mdx/compiler/index.ts";
import { getEsbuild } from "#veryfront/platform/compat/esbuild.ts";
import { dirname, join, relative } from "#veryfront/compat/path";
import { computeHash } from "#veryfront/utils/hash-utils.ts";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
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
      const resolved = targetPath ? await resolveExistingFilePath(targetPath, adapter) : null;

      if (resolved) {
        const entry = { specifier: authoredSpecifier, absolutePath: resolved };
        if (resolved.endsWith(".css")) cssImports.push(entry);
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
      const resolved = await resolveAliasImportPath(aliasPath, projectDir, adapter);
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
  projectDir: string,
  adapter?: RuntimeAdapter,
): Promise<string | null> {
  const normalizedPath = basePath.replace(/^\/+/, "");
  const fs = createFileSystem();
  const projectNormalizedDir = projectDir.replace(/\/+$/, "");

  if (adapter?.fs.resolveFile) {
    try {
      const resolved = await adapter.fs.resolveFile(normalizedPath);
      if (resolved) return resolved;
    } catch (_) {
      /* expected: resolveFile may not be supported */
      // Fall through to manual resolution
    }
  }

  if (HAS_EXTENSION_RE.test(normalizedPath)) {
    const absolutePath = join(projectNormalizedDir, normalizedPath);
    try {
      const stat = await fs.stat(absolutePath);
      return stat.isFile ? absolutePath : null;
    } catch (_) {
      /* expected: file may not exist */
      return null;
    }
  }

  const candidates = [
    ...EXTENSIONS.map((ext) => join(projectNormalizedDir, normalizedPath + ext)),
    ...EXTENSIONS.map((ext) => join(projectNormalizedDir, normalizedPath, "index" + ext)),
  ];

  return await findFirstExistingFile(candidates, fs);
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

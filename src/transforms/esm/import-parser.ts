import { getEsbuild } from "#veryfront/platform/compat/esbuild.ts";
import { join } from "#veryfront/compat/path";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
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

export async function parseLocalImports(
  code: string,
  filePath: string,
  projectDir: string,
  adapter?: RuntimeAdapter,
): Promise<ParseLocalImportsResult> {
  if (filePath.endsWith(".css") || filePath.endsWith(".json")) {
    return { imports: [], cssImports: [], crossProjectImports: [], missing: [] };
  }

  const esbuild = await getEsbuild();
  const result = await esbuild.transform(code, {
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
  const fromDir = fromFile.substring(0, fromFile.lastIndexOf("/"));
  const basePath = resolveRelative(fromDir, importSpecifier);

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

  if (HAS_EXTENSION_RE.test(importSpecifier)) {
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

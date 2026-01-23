import * as esbuild from "esbuild"; // Native esbuild
import { parseImports } from "./lexer.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { getLoaderFromPath } from "./transform-utils.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { isCrossProjectImport, parseCrossProjectImport } from "./path-resolver.ts";
import { join } from "#std/path.ts";

// Framework root directory (veryfront-renderer/) - computed from this file's location
// From src/build/transforms/esm/import-parser.ts, go up 4 levels
const FRAMEWORK_ROOT = new URL("../../../..", import.meta.url).pathname;

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

export interface ParseLocalImportsResult {
  imports: LocalImport[];
  crossProjectImports: CrossProjectImport[];
  missing: MissingImport[];
}

const EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".mdx"];

/**
 * Parse local imports from source code and track missing dependencies.
 * Returns both resolved imports and missing imports for error reporting.
 */
export async function parseLocalImports(
  code: string,
  filePath: string,
  projectDir: string,
  adapter?: RuntimeAdapter,
): Promise<ParseLocalImportsResult> {
  // CSS and JSON files don't have JS imports - skip parsing
  if (filePath.endsWith(".css") || filePath.endsWith(".json")) {
    return { imports: [], crossProjectImports: [], missing: [] };
  }

  // es-module-lexer can't parse TypeScript/JSX, so use esbuild to strip types first
  // This is a minimal transform just for import extraction
  const result = await esbuild.transform(code, {
    loader: getLoaderFromPath(filePath),
    format: "esm",
    target: "esnext",
    jsx: "automatic", // Convert JSX to function calls
    jsxImportSource: "react",
    minify: false,
    sourcemap: false,
    treeShaking: false,
    keepNames: true,
  });

  const imports = await parseImports(result.code);
  const localImports: LocalImport[] = [];
  const crossProjectImports: CrossProjectImport[] = [];
  const missingImports: MissingImport[] = [];

  for (const imp of imports) {
    if (imp.n?.startsWith("./") || imp.n?.startsWith("../")) {
      const resolved = await resolveLocalImportPath(filePath, imp.n, adapter);
      if (resolved) {
        localImports.push({ specifier: imp.n, absolutePath: resolved });
      } else {
        missingImports.push({
          specifier: imp.n,
          fromFile: filePath,
          reason: `File not found: tried extensions ${EXTENSIONS.join(", ")}`,
        });
      }
    } else if (imp.n?.startsWith("@/")) {
      // Handle @/ path aliases - resolve relative to project root
      // In virtual filesystem mode (API-backed), paths are relative like "components/Welcome.tsx"
      // The @/ alias maps to the project root, so we just remove the @/ prefix
      const aliasPath = imp.n.substring(2); // Remove '@/' prefix
      const resolved = await resolveAliasImportPath(aliasPath, projectDir, adapter);
      if (resolved) {
        localImports.push({ specifier: imp.n, absolutePath: resolved });
      } else {
        missingImports.push({
          specifier: imp.n,
          fromFile: filePath,
          reason: `Alias path not found: @/${aliasPath}`,
        });
      }
    } else if (imp.n && isCrossProjectImport(imp.n)) {
      // Handle cross-project versioned imports like demo@0.0/@/components/Button
      const parsed = parseCrossProjectImport(imp.n);
      if (parsed) {
        crossProjectImports.push({
          specifier: imp.n,
          projectSlug: parsed.projectSlug,
          version: parsed.version,
          path: parsed.path,
        });
      }
    }
  }

  return { imports: localImports, crossProjectImports, missing: missingImports };
}

async function checkFileExists(
  path: string,
  adapter?: RuntimeAdapter,
): Promise<boolean> {
  try {
    if (adapter?.fs.stat) {
      const stat = await adapter.fs.stat(path);
      return stat.isFile;
    }
    const fs = createFileSystem();
    const stat = await fs.stat(path);
    return stat.isFile;
  } catch {
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

  // For API-backed filesystems, prefer adapter.fs.resolveFile as it:
  // 1. Handles multiple extensions (.tsx, .ts, .jsx, .js, .mdx, .md)
  // 2. Handles index files (e.g., components/index.ts)
  // 3. Uses API search as fallback (finds files not in initial file list)
  // 4. Returns paths in the format the adapter expects (without leading /)
  if (adapter?.fs.resolveFile) {
    try {
      // Normalize path: remove leading slash for API adapters
      const normalizedPath = basePath.replace(/^\/+/, "");
      const resolved = await adapter.fs.resolveFile(normalizedPath);
      if (resolved) {
        return resolved;
      }
    } catch {
      // Fall through to traditional resolution
    }
  }

  // Traditional resolution (for local filesystem or when adapter.resolveFile fails)
  if (/\.(tsx?|jsx?|mjs|cjs|mdx)$/.test(importSpecifier)) {
    if (await checkFileExists(basePath, adapter)) {
      return basePath;
    }
    return null;
  }

  // Parallelize extension checks for better performance
  // Check all extensions and index files concurrently
  const candidates = [
    ...EXTENSIONS.map((ext) => basePath + ext),
    ...EXTENSIONS.map((ext) => basePath + "/index" + ext),
  ];

  const results = await Promise.all(
    candidates.map(async (path) => ({ path, exists: await checkFileExists(path, adapter) })),
  );

  // Return first match (maintains extension priority order)
  const found = results.find((r) => r.exists);
  return found?.path ?? null;
}

/**
 * Resolve an alias import path (e.g., @/components) to a file path.
 * The basePath should already have @/ prefix removed.
 * In virtual filesystem mode, paths are relative like "components/Welcome".
 * In local filesystem mode, paths need to be resolved relative to projectDir.
 */
async function resolveAliasImportPath(
  basePath: string,
  projectDir: string,
  adapter?: RuntimeAdapter,
): Promise<string | null> {
  // Normalize the path - remove any leading slashes for consistency
  const normalizedPath = basePath.replace(/^\/+/, "");

  // FAST PATH: For lib/* imports, check framework directory FIRST (lib/ is in src/lib/)
  // This avoids expensive project file lookups for framework utilities
  if (normalizedPath.startsWith("lib/")) {
    const fs = createFileSystem();
    // Parallelize extension checks
    const candidates = EXTENSIONS.map((ext) => join(FRAMEWORK_ROOT, "src", normalizedPath + ext));
    const results = await Promise.all(
      candidates.map(async (path) => {
        try {
          const stat = await fs.stat(path);
          return stat.isFile ? path : null;
        } catch {
          return null;
        }
      }),
    );
    const found = results.find((r) => r !== null);
    if (found) return found;
    // If not in framework, fall through to project lookup
  }

  // Use adapter's resolveFile if available - it's more robust and handles:
  // 1. Multiple extensions (.tsx, .ts, .jsx, .js, .mdx, .md)
  // 2. Index files (e.g., lib/utils/index.ts)
  // 3. API search as fallback (finds files not in initial file list)
  if (adapter?.fs.resolveFile) {
    try {
      const resolved = await adapter.fs.resolveFile(normalizedPath);
      if (resolved) {
        return resolved;
      }
    } catch {
      // Fall through to manual resolution
    }
  }

  // Manual resolution fallback (for adapters without resolveFile, e.g., local filesystem)
  // For local development, we need to prepend the projectDir to resolve paths correctly
  const localFs = createFileSystem();
  const projectNormalizedDir = projectDir.replace(/\/+$/, ""); // Remove trailing slashes

  // Check if path already has extension
  if (/\.(tsx?|jsx?|mjs|cjs|mdx)$/.test(normalizedPath)) {
    const absolutePath = join(projectNormalizedDir, normalizedPath);
    try {
      const stat = await localFs.stat(absolutePath);
      if (stat.isFile) {
        return absolutePath;
      }
    } catch {
      // File not found
    }
    return null;
  }

  // Parallelize all extension and index file checks
  const candidates = [
    ...EXTENSIONS.map((ext) => join(projectNormalizedDir, normalizedPath + ext)),
    ...EXTENSIONS.map((ext) => join(projectNormalizedDir, normalizedPath, "index" + ext)),
    // Include framework lib paths for lib/* imports
    ...(normalizedPath.startsWith("lib/")
      ? EXTENSIONS.map((ext) => join(FRAMEWORK_ROOT, "src", normalizedPath + ext))
      : []),
  ];

  const results = await Promise.all(
    candidates.map(async (path) => {
      try {
        const stat = await localFs.stat(path);
        return stat.isFile ? path : null;
      } catch {
        return null;
      }
    }),
  );

  // Return first match (maintains extension priority order)
  return results.find((r) => r !== null) ?? null;
}

function resolveRelative(fromDir: string, importPath: string): string {
  const parts = fromDir.split("/").filter(Boolean);
  const importParts = importPath.split("/").filter(Boolean);

  for (const part of importParts) {
    if (part === "..") {
      parts.pop();
    } else if (part !== ".") {
      parts.push(part);
    }
  }

  return "/" + parts.join("/");
}

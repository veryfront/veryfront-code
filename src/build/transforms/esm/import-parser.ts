import * as esbuild from "esbuild/mod.js"; // Native esbuild
import { parseImports } from "./lexer.ts";
import { createFileSystem } from "../../../platform/compat/fs.ts";
import { getLoaderFromPath } from "./transform-utils.ts";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";

export interface LocalImport {
  specifier: string;
  absolutePath: string;
}

const EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".mdx"];

export async function parseLocalImports(
  code: string,
  filePath: string,
  _projectDir: string,
  adapter?: RuntimeAdapter,
): Promise<LocalImport[]> {
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

  for (const imp of imports) {
    if (imp.n?.startsWith("./") || imp.n?.startsWith("../")) {
      const resolved = await resolveLocalImportPath(filePath, imp.n, adapter);
      if (resolved) {
        localImports.push({ specifier: imp.n, absolutePath: resolved });
      }
    } else if (imp.n?.startsWith("@/")) {
      // Handle @/ path aliases - resolve relative to project root
      // In virtual filesystem mode (API-backed), paths are relative like "components/Welcome.tsx"
      // The @/ alias maps to the project root, so we just remove the @/ prefix
      const aliasPath = imp.n.substring(2); // Remove '@/' prefix
      const resolved = await resolveAliasImportPath(aliasPath, adapter);
      if (resolved) {
        localImports.push({ specifier: imp.n, absolutePath: resolved });
      }
    }
  }

  return localImports;
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

  if (/\.(tsx?|jsx?|mjs|cjs|mdx)$/.test(importSpecifier)) {
    if (await checkFileExists(basePath, adapter)) {
      return basePath;
    }
    return null;
  }

  for (const ext of EXTENSIONS) {
    const fullPath = basePath + ext;
    if (await checkFileExists(fullPath, adapter)) {
      return fullPath;
    }
  }

  for (const ext of EXTENSIONS) {
    const indexPath = basePath + "/index" + ext;
    if (await checkFileExists(indexPath, adapter)) {
      return indexPath;
    }
  }

  return null;
}

/**
 * Resolve an alias import path (e.g., @/components) to a file path.
 * The basePath should already have @/ prefix removed.
 * In virtual filesystem mode, paths are relative like "components/Welcome".
 */
async function resolveAliasImportPath(
  basePath: string,
  adapter?: RuntimeAdapter,
): Promise<string | null> {
  // Normalize the path - remove any leading slashes for consistency
  const normalizedPath = basePath.replace(/^\/+/, "");

  // Check if path already has extension
  if (/\.(tsx?|jsx?|mjs|cjs|mdx)$/.test(normalizedPath)) {
    if (await checkFileExists(normalizedPath, adapter)) {
      return normalizedPath;
    }
    return null;
  }

  // Try common extensions
  for (const ext of EXTENSIONS) {
    const fullPath = normalizedPath + ext;
    if (await checkFileExists(fullPath, adapter)) {
      return fullPath;
    }
  }

  // Try index files
  for (const ext of EXTENSIONS) {
    const indexPath = normalizedPath + "/index" + ext;
    if (await checkFileExists(indexPath, adapter)) {
      return indexPath;
    }
  }

  return null;
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

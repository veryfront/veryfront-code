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
    }
  }

  return localImports;
}

async function resolveLocalImportPath(
  fromFile: string,
  importSpecifier: string,
  adapter?: RuntimeAdapter,
): Promise<string | null> {
  const fromDir = fromFile.substring(0, fromFile.lastIndexOf("/"));
  const basePath = resolveRelative(fromDir, importSpecifier);

  const checkFileExists = async (path: string): Promise<boolean> => {
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
  };

  if (/\.(tsx?|jsx?|mjs|cjs|mdx)$/.test(importSpecifier)) {
    if (await checkFileExists(basePath)) {
      return basePath;
    }
    return null;
  }

  for (const ext of EXTENSIONS) {
    const fullPath = basePath + ext;
    if (await checkFileExists(fullPath)) {
      return fullPath;
    }
  }

  for (const ext of EXTENSIONS) {
    const indexPath = basePath + "/index" + ext;
    if (await checkFileExists(indexPath)) {
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

import * as esbuild from "esbuild";
import { parseImports } from "./lexer.ts";
import { createFileSystem } from "../../../platform/compat/fs.ts";
import { getLoaderFromPath } from "./transform-utils.ts";

export interface LocalImport {
  specifier: string;
  absolutePath: string;
}

const EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".mdx"];

export async function parseLocalImports(
  code: string,
  filePath: string,
  _projectDir: string,
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
      const resolved = await resolveLocalImportPath(filePath, imp.n);
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
): Promise<string | null> {
  const fs = createFileSystem();
  const fromDir = fromFile.substring(0, fromFile.lastIndexOf("/"));
  const basePath = resolveRelative(fromDir, importSpecifier);

  // If specifier already has a valid extension, check if file exists
  if (/\.(tsx?|jsx?|mjs|cjs|mdx)$/.test(importSpecifier)) {
    try {
      const stat = await fs.stat(basePath);
      if (stat.isFile) {
        return basePath;
      }
    } catch {
      // File doesn't exist
    }
    return null;
  }

  // Try each extension
  for (const ext of EXTENSIONS) {
    const fullPath = basePath + ext;
    try {
      const stat = await fs.stat(fullPath);
      if (stat.isFile) {
        return fullPath;
      }
    } catch {
      // Continue trying other extensions
    }
  }

  // Try index files (e.g., ./components -> ./components/index.tsx)
  for (const ext of EXTENSIONS) {
    const indexPath = basePath + "/index" + ext;
    try {
      const stat = await fs.stat(indexPath);
      if (stat.isFile) {
        return indexPath;
      }
    } catch {
      // Continue trying other extensions
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

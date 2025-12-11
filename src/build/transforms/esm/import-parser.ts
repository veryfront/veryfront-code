import * as esbuild from "esbuild";
import { parseImports } from "./lexer.ts";
import { createFileSystem } from "../../../platform/compat/fs.ts";
import { getLoaderFromPath } from "./transform-utils.ts";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";

export interface LocalImport {
  specifier: string;
  absolutePath: string;
}

export interface ParseLocalImportsOptions {
  adapter?: RuntimeAdapter;
}

const EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".mdx"];

export async function parseLocalImports(
  code: string,
  filePath: string,
  projectDir: string,
  options?: ParseLocalImportsOptions,
): Promise<LocalImport[]> {
  let transformedCode: string;

  if (filePath.endsWith(".mdx")) {
    const importMatches = code.matchAll(
      /^import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)(?:\s*,\s*(?:\{[^}]*\}|\*\s+as\s+\w+|\w+))*\s+from\s+)?['"]([^'"]+)['"]\s*;?\s*$/gm,
    );
    const imports: Array<{ n: string | undefined }> = [];
    for (const match of importMatches) {
      imports.push({ n: match[1] });
    }
    const localImports: LocalImport[] = [];
    const normalizedProjectDir = projectDir.replace(/\/$/, "");

    for (const imp of imports) {
      if (imp.n?.startsWith("./") || imp.n?.startsWith("../")) {
        const resolved = await resolveLocalImportPath(filePath, imp.n, options?.adapter);
        if (resolved) {
          localImports.push({ specifier: imp.n, absolutePath: resolved });
        }
      } else if (imp.n?.startsWith("@/")) {
        const aliasPath = imp.n.substring(2);
        const resolved = await resolveAliasImportPath(
          normalizedProjectDir,
          aliasPath,
          options?.adapter,
        );
        if (resolved) {
          localImports.push({ specifier: imp.n, absolutePath: resolved });
        }
      }
    }
    return localImports;
  }

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

  transformedCode = result.code;
  const imports = await parseImports(transformedCode);
  const localImports: LocalImport[] = [];
  const normalizedProjectDir = projectDir.replace(/\/$/, "");

  for (const imp of imports) {
    if (imp.n?.startsWith("./") || imp.n?.startsWith("../")) {
      const resolved = await resolveLocalImportPath(filePath, imp.n, options?.adapter);
      if (resolved) {
        localImports.push({ specifier: imp.n, absolutePath: resolved });
      }
    }
    else if (imp.n?.startsWith("@/")) {
      const aliasPath = imp.n.substring(2);
      const resolved = await resolveAliasImportPath(
        normalizedProjectDir,
        aliasPath,
        options?.adapter,
      );
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
  const localFs = createFileSystem();
  const fromDir = fromFile.substring(0, fromFile.lastIndexOf("/"));
  const basePath = resolveRelative(fromDir, importSpecifier);

  const statFile = async (path: string): Promise<{ isFile: boolean } | null> => {
    try {
      if (adapter) {
        return await adapter.fs.stat(path);
      }
      return await localFs.stat(path);
    } catch {
      return null;
    }
  };

  if (/\.(tsx?|jsx?|mjs|cjs|mdx)$/.test(importSpecifier)) {
    const stat = await statFile(basePath);
    if (stat?.isFile) {
      return basePath;
    }
    return null;
  }

  for (const ext of EXTENSIONS) {
    const fullPath = basePath + ext;
    const stat = await statFile(fullPath);
    if (stat?.isFile) {
      return fullPath;
    }
  }

  for (const ext of EXTENSIONS) {
    const indexPath = basePath + "/index" + ext;
    const stat = await statFile(indexPath);
    if (stat?.isFile) {
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

async function resolveAliasImportPath(
  projectDir: string,
  aliasPath: string,
  adapter?: RuntimeAdapter,
): Promise<string | null> {
  const localFs = createFileSystem();
  const basePath = `${projectDir}/${aliasPath}`;

  const statFile = async (path: string): Promise<{ isFile: boolean } | null> => {
    try {
      if (adapter) {
        return await adapter.fs.stat(path);
      }
      return await localFs.stat(path);
    } catch {
      return null;
    }
  };

  if (/\.(tsx?|jsx?|mjs|cjs|mdx)$/.test(aliasPath)) {
    const stat = await statFile(basePath);
    if (stat?.isFile) {
      return basePath;
    }
    return null;
  }

  for (const ext of EXTENSIONS) {
    const fullPath = basePath + ext;
    const stat = await statFile(fullPath);
    if (stat?.isFile) {
      return fullPath;
    }
  }

  for (const ext of EXTENSIONS) {
    const indexPath = basePath + "/index" + ext;
    const stat = await statFile(indexPath);
    if (stat?.isFile) {
      return indexPath;
    }
  }

  return null;
}

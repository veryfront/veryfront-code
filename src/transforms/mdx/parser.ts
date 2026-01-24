import { rendererLogger as logger } from "#veryfront/utils";
import type { MDXExports, MDXImportInfo, ParsedMDX } from "./types.ts";
import { extractFrontmatter, extractMetadata } from "./module-loader/metadata-extractor.ts";

export type { ParsedMDX };

export function parseMDXCode(compiledCode: string): ParsedMDX {
  logger.debug("Parsing MDX code, first 200 chars:", compiledCode.substring(0, 200));

  const importRegex = /^\s*import\s+(?:{([^}]+)}|(\w+))\s+from\s+['"]([^'"]+)['"]\s*;?\s*$/gm;

  const imports = new Map<string, MDXImportInfo>();

  for (const match of compiledCode.matchAll(importRegex)) {
    const path = match[3];
    if (!path) continue;

    const namedImports = match[1];
    if (namedImports) {
      for (const name of namedImports.split(",").map((n) => n.trim())) {
        imports.set(name, { name, path, isDefault: false });
      }
      continue;
    }

    const defaultImport = match[2];
    if (defaultImport) {
      imports.set(defaultImport, { name: defaultImport, path, isDefault: true });
    }
  }

  const cleanedCode = compiledCode
    .replace(importRegex, "") // Remove top-level imports
    .replace(/^\s*export\s+\{[\s\S]*?\};?\s*$/gm, "") // Remove named exports
    .replace(/^\s*export\s+default\s+function/gm, "function") // Convert default export function
    .replace(/^\s*export\s+default\s+/gm, "") // Remove other default exports
    .replace(/^\s*export\s+(const|function)\s+/gm, "$1 ") // Convert export const/function
    .replace(/^\s*import\s+React\s+from.*?;?\s*$/gm, "") // Remove React imports
    .replace(
      /^\s*const\s+(React|Fragment|Fragment2|jsx|jsx2|jsxs|jsxs2)\s*=.*?;?\s*$/gm,
      "",
    ); // Remove runtime declarations

  if (cleanedCode.includes("import React")) {
    logger.warn("Import React still in cleaned code");
  }

  if (cleanedCode.includes("const React") || cleanedCode.includes("var React")) {
    logger.warn("React declaration found in cleaned code");
    logger.debug("Code snippet:", cleanedCode.substring(0, 200));
  }

  const exports: MDXExports = {};

  const frontmatter = extractFrontmatter(cleanedCode);
  if (frontmatter) exports.frontmatter = frontmatter;

  const metadata = extractMetadata(cleanedCode);
  for (const [key, value] of Object.entries(metadata)) {
    if (value !== undefined) {
      (exports as Record<string, unknown>)[key] = value;
    }
  }

  return { code: cleanedCode, imports, exports };
}

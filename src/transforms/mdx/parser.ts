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

    if (match[1]) {
      // Named imports: import { a, b } from 'path'
      for (const name of match[1].split(",").map((n) => n.trim())) {
        imports.set(name, { name, path, isDefault: false });
      }
    } else if (match[2]) {
      // Default import: import X from 'path'
      imports.set(match[2], { name: match[2], path, isDefault: true });
    }
  }

  // Clean up imports, exports, and React runtime declarations
  const cleanupPatterns: [RegExp, string][] = [
    [importRegex, ""], // Remove top-level imports
    [/^\s*export\s+\{[\s\S]*?\};?\s*$/gm, ""], // Remove named exports
    [/^\s*export\s+default\s+function/gm, "function"], // Convert default export function
    [/^\s*export\s+default\s+/gm, ""], // Remove other default exports
    [/^\s*export\s+(const|function)\s+/gm, "$1 "], // Convert export const/function
    [/^\s*import\s+React\s+from.*?;?\s*$/gm, ""], // Remove React imports
    [/^\s*const\s+(React|Fragment|Fragment2|jsx|jsx2|jsxs|jsxs2)\s*=.*?;?\s*$/gm, ""], // Remove runtime declarations
  ];

  const cleanedCode = cleanupPatterns.reduce(
    (code, [pattern, replacement]) => code.replace(pattern, replacement),
    compiledCode,
  );

  if (cleanedCode.includes("import React")) {
    logger.warn("Import React still in cleaned code");
  }
  if (cleanedCode.includes("const React") || cleanedCode.includes("var React")) {
    logger.warn("React declaration found in cleaned code");
    logger.debug("Code snippet:", cleanedCode.substring(0, 200));
  }

  const exports: MDXExports = {};

  const frontmatter = extractFrontmatter(cleanedCode);
  if (frontmatter) {
    exports.frontmatter = frontmatter;
  }

  const metadata = extractMetadata(cleanedCode);
  for (const [key, value] of Object.entries(metadata)) {
    if (value !== undefined) {
      (exports as Record<string, unknown>)[key] = value;
    }
  }

  return { code: cleanedCode, imports, exports };
}

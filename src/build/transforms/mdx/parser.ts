import { rendererLogger as logger } from "@veryfront/utils";
import type { MDXExports, MDXImportInfo, ParsedMDX } from "./types.ts";
import {
  extractFrontmatter,
  extractMetadata,
} from "./module-loader/metadata-extractor.ts";

export type { ParsedMDX };

export function parseMDXCode(compiledCode: string): ParsedMDX {
  logger.debug("Parsing MDX code, first 200 chars:", compiledCode.substring(0, 200));
  const importRegex = /^\s*import\s+(?:{([^}]+)}|(\w+))\s+from\s+['"]([^'"]+)['"]\s*;?\s*$/gm;
  const imports = new Map<string, MDXImportInfo>();
  let match: RegExpExecArray | null;

  while ((match = importRegex.exec(compiledCode)) !== null) {
    if (match[1]) {
      const names = match[1].split(",").map((n: string) => n.trim());
      names.forEach((name: string) => {
        if (match?.[3]) {
          imports.set(name, { name, path: match[3], isDefault: false });
        }
      });
    } else if (match[2]) {
      if (match[2] && match[3]) {
        imports.set(match[2], {
          name: match[2],
          path: match[3],
          isDefault: true,
        });
      }
    }
  }

  const cleanedCode = compiledCode
    .replace(importRegex, "") // Remove top-level imports
    .replace(/^\s*export\s+\{[\s\S]*?\};?\s*$/gm, "") // Remove named exports (including multi-line)
    .replace(/^\s*export\s+default\s+function/gm, "function") // Convert default export function
    .replace(/^\s*export\s+default\s+/gm, "") // Remove other default exports
    .replace(/^\s*export\s+const\s+/gm, "const ") // Convert export const to const
    .replace(/^\s*export\s+function\s+/gm, "function ") // Convert export function to function
    .replace(/^\s*const\s+React\s*=.*?;?\s*$/gm, "") // Remove React declarations
    .replace(/^\s*import\s+React\s+from.*?;?\s*$/gm, "") // Remove React imports
    .replace(/^\s*const\s+(Fragment|Fragment2)\s*=.*?;?\s*$/gm, "") // Remove Fragment declarations
    .replace(/^\s*const\s+(jsx|jsx2)\s*=.*?;?\s*$/gm, "") // Remove jsx declarations
    .replace(/^\s*const\s+(jsxs|jsxs2)\s*=.*?;?\s*$/gm, ""); // Remove jsxs declarations

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

import { rendererLogger as logger } from "@veryfront/utils";
import type { MDXExports, MDXImportInfo, ParsedMDX } from "./types.ts";

export type { ParsedMDX };

export function parseMDXCode(compiledCode: string): ParsedMDX {
  logger.debug("Parsing MDX code, first 200 chars:", compiledCode.substring(0, 200));
  const importRegex = /import\s+(?:{([^}]+)}|(\w+))\s+from\s+['"]([^'"]+)['"]/g;
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
    .replace(/import\s+.*?from\s+['"][^'"]+['"];?\s*/gm, "") // Remove imports (multiline mode)
    .replace(/export\s+\{[\s\S]*?\};?/gm, "") // Remove named exports (including multi-line)
    .replace(/export\s+default\s+function/gm, "function") // Convert default export function
    .replace(/export\s+default\s+/gm, "") // Remove other default exports
    .replace(/export\s+const\s+/gm, "const ") // Convert export const to const
    .replace(/export\s+function\s+/gm, "function ") // Convert export function to function
    .replace(/^const\s+React\s*=.*?;?\s*$/gm, "") // Remove React declarations
    .replace(/^import\s+React\s+from.*?;?\s*$/gm, "") // Remove React imports
    .replace(/^const\s+(Fragment|Fragment2)\s*=.*?;?\s*$/gm, "") // Remove Fragment declarations
    .replace(/^const\s+(jsx|jsx2)\s*=.*?;?\s*$/gm, "") // Remove jsx declarations
    .replace(/^const\s+(jsxs|jsxs2)\s*=.*?;?\s*$/gm, ""); // Remove jsxs declarations

  if (cleanedCode.includes("import React")) {
    logger.warn("Import React still in cleaned code");
  }
  if (cleanedCode.includes("const React") || cleanedCode.includes("var React")) {
    logger.warn("React declaration found in cleaned code");
    logger.debug("Code snippet:", cleanedCode.substring(0, 200));
  }

  const exports: MDXExports = {};

  const frontmatterMatch = cleanedCode.match(/const\s+frontmatter\s*=\s*({[\s\S]*?});/);
  if (frontmatterMatch) {
    try {
      const objectLiteral = (frontmatterMatch[1] ?? "{}")
        .replace(/(\w+):/g, '"$1":') // Convert keys to strings
        .replace(/'/g, '"'); // Convert single quotes to double
      exports.frontmatter = JSON.parse(objectLiteral);
    } catch {
      logger.debug("[MDX] Could not parse frontmatter statically, will extract at runtime");
    }
  }

  const exportMatches = [
    { regex: /const\s+title\s*=\s*["']([^"']+)["']/, key: "title", parse: (v: string) => v },
    {
      regex: /const\s+description\s*=\s*["']([^"']+)["']/,
      key: "description",
      parse: (v: string) => v,
    },
    { regex: /const\s+layout\s*=\s*true/, key: "layout", parse: () => true },
    { regex: /const\s+layout\s*=\s*false/, key: "layout", parse: () => false },
    { regex: /const\s+layout\s*=\s*["']([^"']+)["']/, key: "layout", parse: (v: string) => v },
    {
      regex: /const\s+headings\s*=\s*(\[[\s\S]*?\]);/,
      key: "headings",
      parse: (v: string) => {
        try {
          return JSON.parse(v.replace(/'/g, '"'));
        } catch {
          return [];
        }
      },
    },
  ];

  exportMatches.forEach(({ regex, key, parse }) => {
    const m = cleanedCode.match(regex);
    if (m) {
      try {
        exports[key] = parse(m[1] || m[0]);
      } catch (_error) {
        void _error;
      }
    }
  });

  return { code: cleanedCode, imports, exports };
}

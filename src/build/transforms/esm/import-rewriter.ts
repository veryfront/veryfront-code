import { parseImports, replaceSpecifiers, rewriteImports } from "./lexer.ts";
import { REACT_DEFAULT_VERSION } from "@veryfront/utils/constants/cdn.ts";

export function rewriteBareImports(code: string, _moduleServerUrl?: string): Promise<string> {
  // Always use esm.sh URLs for React packages in browser mode
  // The _vendor/ path approach requires a handler to serve vendor modules,
  // which is not implemented. Using esm.sh ensures React is loaded correctly.
  const importMap: Record<string, string> = {
    "react": `https://esm.sh/react@${REACT_DEFAULT_VERSION}`,
    "react-dom": `https://esm.sh/react-dom@${REACT_DEFAULT_VERSION}`,
    "react-dom/client": `https://esm.sh/react-dom@${REACT_DEFAULT_VERSION}/client`,
    "react-dom/server": `https://esm.sh/react-dom@${REACT_DEFAULT_VERSION}/server`,
    "react/jsx-runtime": `https://esm.sh/react@${REACT_DEFAULT_VERSION}/jsx-runtime`,
    "react/jsx-dev-runtime": `https://esm.sh/react@${REACT_DEFAULT_VERSION}/jsx-dev-runtime`,
    // React Query must use same URL as HTML import map to avoid multiple module instances
    "@tanstack/react-query": `https://esm.sh/@tanstack/react-query@5?external=react`,
    // NOTE: veryfront/ai/react is NOT rewritten here - it's handled by the HTML import map
    // which points to /_veryfront/lib/ai/react.js served from the local package
  };

  return Promise.resolve(replaceSpecifiers(code, (specifier) => {
    // Check known import map first
    if (importMap[specifier]) {
      return importMap[specifier]!;
    }

    // Skip if already absolute URL, relative path, or local module path
    if (
      specifier.startsWith("http://") ||
      specifier.startsWith("https://") ||
      specifier.startsWith("./") ||
      specifier.startsWith("../") ||
      specifier.startsWith("/") ||
      specifier.startsWith("@/") || // Project alias
      specifier.startsWith("veryfront") // Veryfront packages
    ) {
      return null;
    }

    // Convert remaining bare imports (npm packages) to esm.sh URLs
    // Include react deps for proper bundling
    return `https://esm.sh/${specifier}?deps=react@${REACT_DEFAULT_VERSION},react-dom@${REACT_DEFAULT_VERSION}`;
  }));
}

export async function rewriteVendorImports(
  code: string,
  moduleServerUrl: string,
  vendorBundleHash: string,
): Promise<string> {
  const vendorUrl = `${moduleServerUrl}/_vendor.js?v=${vendorBundleHash}`;

  const reactPackages = new Set([
    "react",
    "react-dom",
    "react-dom/client",
    "react-dom/server",
    "react/jsx-runtime",
    "react/jsx-dev-runtime",
  ]);

  // First, preserve export statements by only swapping the specifier
  let result = await rewriteImports(code, (imp, statement) => {
    if (!imp.n || !reactPackages.has(imp.n)) return null;
    const trimmed = statement.trimStart();
    if (!trimmed.startsWith("export")) return null;

    const specStart = imp.s - imp.ss;
    const specEnd = imp.e - imp.ss;
    const before = statement.slice(0, specStart);
    const after = statement.slice(specEnd);
    return `${before}${vendorUrl}${after}`;
  });

  // Re-parse after export rewrites
  const baseSource = result;
  const imports = await parseImports(baseSource);

  // Process in reverse order to maintain indices
  for (let i = imports.length - 1; i >= 0; i--) {
    const imp = imports[i];
    if (!imp) continue;

    // Skip if not a vendor package
    if (!imp.n || !reactPackages.has(imp.n)) continue;

    const exportName = sanitizeVendorExportName(imp.n);

    if (imp.d > -1) {
      // Dynamic import: import('react') -> import('vendor').then(m => m.react)
      // imp.d is start of `import(`, imp.e is end of specifier content

      // Find closing paren after the specifier
      const afterSpecifier = baseSource.substring(imp.e);
      // Matches closing quote then closing paren
      const match = afterSpecifier.match(/^['"]\s*\)/);

      if (!match) continue;

      const endOfCall = imp.e + match[0].length;

      const before = result.substring(0, imp.d);
      const after = result.substring(endOfCall);
      const replacement = `import('${vendorUrl}').then(m => m.${exportName})`;

      result = before + replacement + after;
    } else {
      // Static import
      // Extract the part between "import" and "from"
      const beforeSpecifier = baseSource.substring(imp.ss, imp.s);
      const fromIndex = beforeSpecifier.lastIndexOf("from");

      if (fromIndex === -1) {
        // Side-effect import: import 'react'
        const before = result.substring(0, imp.ss);
        const after = result.substring(imp.se);
        result = before + `import '${vendorUrl}'` + after;
        continue;
      }

      // Extract the import clause (e.g., "{ useState }", "React", "* as React")
      // "import " is length 7
      const clause = beforeSpecifier.substring(6, fromIndex).trim();

      let replacement = "";
      if (clause.startsWith("*")) {
        // import * as React from 'react'
        replacement = `import ${clause} from '${vendorUrl}'`;
      } else if (clause.startsWith("{")) {
        // import { useState } from 'react'
        // -> import { react } from 'vendor'; const { useState } = react;
        replacement =
          `import { ${exportName} } from '${vendorUrl}'; const ${clause} = ${exportName}`;
      } else {
        // import React from 'react'
        // -> import { react as React } from 'vendor'
        replacement = `import { ${exportName} as ${clause} } from '${vendorUrl}'`;
      }

      const before = result.substring(0, imp.ss);
      const after = result.substring(imp.se);
      result = before + replacement + after;
    }
  }

  return result;
}

function sanitizeVendorExportName(pkg: string): string {
  return pkg
    .replace(/^@/, "") // Remove @ prefix
    .replace(/[\/\-]/g, "_") // Replace / and - with _
    .replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()) // camelCase
    .replace(/^_/, ""); // Remove leading underscore
}

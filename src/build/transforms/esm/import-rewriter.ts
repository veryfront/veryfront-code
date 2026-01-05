import { parseImports, replaceSpecifiers, rewriteImports } from "./lexer.ts";
import { REACT_DEFAULT_VERSION, TAILWIND_VERSION } from "@veryfront/utils/constants/cdn.ts";
import { rendererLogger as logger } from "@veryfront/utils";

/**
 * Track unversioned imports to warn users about reproducibility.
 * Imports without explicit versions may break when packages update.
 */
const unversionedImportsWarned = new Set<string>();

/**
 * Check if a specifier has an inline version specifier.
 * Returns true for: pkg@1.2.3, pkg@^1.2.3, @scope/pkg@1.2.3
 */
function hasVersionSpecifier(specifier: string): boolean {
  // Match @version patterns: @1.2.3, @^1.2.3, @~1.2.3, @1.x
  return /@[\d^~x][\d.x^~-]*(?=\/|$)/.test(specifier);
}

/**
 * Warn about unversioned npm imports for reproducibility.
 * These imports can break when packages update on esm.sh.
 */
function warnUnversionedImport(specifier: string): void {
  // Only warn once per specifier to avoid spam
  if (unversionedImportsWarned.has(specifier)) {
    return;
  }
  unversionedImportsWarned.add(specifier);

  // Suggest a versioned import
  const suggestedVersion = "x.y.z"; // User needs to find actual version
  const packageName = specifier.split("/")[0];
  const isScoped = specifier.startsWith("@");
  const scopedPackage = isScoped ? specifier.split("/").slice(0, 2).join("/") : packageName;
  const subpath = isScoped
    ? specifier.split("/").slice(2).join("/")
    : specifier.split("/").slice(1).join("/");
  const versionedSpecifier = subpath
    ? `${scopedPackage}@${suggestedVersion}/${subpath}`
    : `${scopedPackage}@${suggestedVersion}`;

  logger.warn("[ESM] Unversioned import may cause reproducibility issues", {
    import: specifier,
    suggestion: `Pin version: import '${versionedSpecifier}'`,
    help: "Run 'npm info " + (isScoped ? scopedPackage : packageName!) +
      " version' to find current version",
  });
}

/**
 * Normalize package specifier by stripping inline version specifiers.
 * This ensures all imports of a package use the same version from the import map.
 *
 * Examples:
 *   "tailwindcss@3.4.17/plugin" -> "tailwindcss/plugin"
 *   "tailwindcss@^4.1.17/colors" -> "tailwindcss/colors"
 *   "@tailwindcss/typography@0.5.16" -> "@tailwindcss/typography"
 */
function normalizeVersionedSpecifier(specifier: string): string {
  // Match package@version patterns and strip the version
  // Handles: pkg@1.2.3, pkg@^1.2.3, pkg@~1.2.3, pkg@1.x, @scope/pkg@1.2.3
  return specifier.replace(/@[\d^~x][\d.x^~-]*(?=\/|$)/, "");
}

export function rewriteBareImports(code: string, _moduleServerUrl?: string): Promise<string> {
  // Always use esm.sh URLs for React packages in browser mode
  // The _vendor/ path approach requires a handler to serve vendor modules,
  // which is not implemented. Using esm.sh ensures React is loaded correctly.
  // Packages that should be kept as bare specifiers for HTML import map to resolve
  // These need consistent module instances, so HTML import map handles them
  const htmlImportMapPackages = [
    "@tanstack/react-query",
    "@tanstack/query-core",
    "next-themes",
    "framer-motion",
  ];

  // Use ?target=es2022 to ensure identical builds between SSR (Deno) and browser
  // Without this, esm.sh auto-detects target and may serve different builds, causing hydration mismatches
  const importMap: Record<string, string> = {
    "react": `https://esm.sh/react@${REACT_DEFAULT_VERSION}?target=es2022`,
    "react-dom": `https://esm.sh/react-dom@${REACT_DEFAULT_VERSION}?target=es2022`,
    "react-dom/client": `https://esm.sh/react-dom@${REACT_DEFAULT_VERSION}/client?target=es2022`,
    "react-dom/server": `https://esm.sh/react-dom@${REACT_DEFAULT_VERSION}/server?target=es2022`,
    "react/jsx-runtime": `https://esm.sh/react@${REACT_DEFAULT_VERSION}/jsx-runtime?target=es2022`,
    "react/jsx-dev-runtime": `https://esm.sh/react@${REACT_DEFAULT_VERSION}/jsx-dev-runtime?target=es2022`,
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

    // Normalize: strip inline version specifiers (e.g., tailwindcss@3.4.17 -> tailwindcss)
    // This allows the import map in HTML to control the actual version
    const normalized = normalizeVersionedSpecifier(specifier);

    // Check if this package should be kept as a bare specifier for HTML import map
    // This ensures consistent module instances for context-dependent packages
    const matchesImportMapPackage = htmlImportMapPackages.some(
      (pkg) => normalized === pkg || normalized.startsWith(`${pkg}/`),
    );
    if (matchesImportMapPackage) {
      return null; // Keep as bare specifier - HTML import map will resolve it
    }

    // Pin tailwindcss to unified version to prevent multiple versions loading
    let finalSpecifier = normalized;
    if (normalized === "tailwindcss" || normalized.startsWith("tailwindcss/")) {
      finalSpecifier = normalized.replace(/^tailwindcss/, `tailwindcss@${TAILWIND_VERSION}`);
    } else if (!hasVersionSpecifier(specifier)) {
      // Warn about unversioned imports for reproducibility
      // Skip warning for known packages that we pin versions for
      warnUnversionedImport(specifier);
    }

    // Convert remaining bare imports (npm packages) to esm.sh URLs
    // Use ?external=react,react-dom so esm.sh does NOT bundle React inside packages.
    // Instead, packages will import React from the browser's import map (shared instance).
    // Use ?target=es2022 to ensure identical builds between SSR and browser.
    return `https://esm.sh/${finalSpecifier}?external=react,react-dom&target=es2022`;
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

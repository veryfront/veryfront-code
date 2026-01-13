import { parseImports, replaceSpecifiers, rewriteImports } from "./lexer.ts";
import { REACT_DEFAULT_VERSION, TAILWIND_VERSION } from "@veryfront/utils/constants/cdn.ts";
import { rendererLogger as logger } from "@veryfront/utils";

/**
 * Add HMR cache-busting timestamps to all local imports.
 *
 * This is crucial for HMR to work correctly. ES modules are cached by full URL
 * including query strings. Without this, nested imports like:
 *   import HeroSection from '../components/HeroSection.js'
 * would return cached versions even after the file changes.
 *
 * With timestamp injection:
 *   import HeroSection from '../components/HeroSection.js?t=1705123456789'
 *
 * @param code - The JavaScript/TypeScript code to transform
 * @param timestamp - The cache-busting timestamp to add
 * @returns Promise resolving to code with timestamped local imports
 */
export function addHMRTimestamps(code: string, timestamp: string | number): Promise<string> {
  return replaceSpecifiers(code, (specifier: string) => {
    // Only add timestamp to local imports (relative paths and alias paths)
    const isLocalImport =
      specifier.startsWith("./") ||
      specifier.startsWith("../") ||
      specifier.startsWith("/") ||
      specifier.startsWith("@/");

    if (!isLocalImport) return null;

    // Skip if already has a timestamp parameter
    if (specifier.includes("?t=") || specifier.includes("&t=")) return null;

    // Skip external URLs
    if (specifier.startsWith("http://") || specifier.startsWith("https://")) return null;

    // Add timestamp as query parameter
    const separator = specifier.includes("?") ? "&" : "?";
    return `${specifier}${separator}t=${timestamp}`;
  });
}

/** Track unversioned imports to warn only once per specifier */
const unversionedImportsWarned = new Set<string>();

/** Check if specifier has inline version: pkg@1.2.3, @scope/pkg@1.2.3 */
function hasVersionSpecifier(specifier: string): boolean {
  return /@[\d^~x][\d.x^~-]*(?=\/|$)/.test(specifier);
}

/** Warn about unversioned npm imports for reproducibility */
function warnUnversionedImport(specifier: string): void {
  if (unversionedImportsWarned.has(specifier)) return;
  unversionedImportsWarned.add(specifier);

  const isScoped = specifier.startsWith("@");
  const parts = specifier.split("/");
  const packageName = isScoped ? parts.slice(0, 2).join("/") : parts[0]!;

  logger.warn("[ESM] Unversioned import may cause reproducibility issues", {
    import: specifier,
    suggestion: `Pin version: import '${packageName}@x.y.z'`,
    help: `Run 'npm info ${packageName} version' to find current version`,
  });
}

/** Strip inline version specifiers: tailwindcss@3.4.17/plugin -> tailwindcss/plugin */
function normalizeVersionedSpecifier(specifier: string): string {
  return specifier.replace(/@[\d^~x][\d.x^~-]*(?=\/|$)/, "");
}

/** Packages kept as bare specifiers for HTML import map to resolve */
const HTML_IMPORT_MAP_PACKAGES = [
  "@tanstack/react-query",
  "@tanstack/query-core",
  "next-themes",
  "framer-motion",
];

/** React import map with consistent es2022 target for SSR/browser parity */
const REACT_IMPORT_MAP: Record<string, string> = {
  "react": `https://esm.sh/react@${REACT_DEFAULT_VERSION}?target=es2022`,
  "react-dom": `https://esm.sh/react-dom@${REACT_DEFAULT_VERSION}?target=es2022`,
  "react-dom/client": `https://esm.sh/react-dom@${REACT_DEFAULT_VERSION}/client?target=es2022`,
  "react-dom/server": `https://esm.sh/react-dom@${REACT_DEFAULT_VERSION}/server?target=es2022`,
  "react/jsx-runtime": `https://esm.sh/react@${REACT_DEFAULT_VERSION}/jsx-runtime?target=es2022`,
  "react/jsx-dev-runtime":
    `https://esm.sh/react@${REACT_DEFAULT_VERSION}/jsx-dev-runtime?target=es2022`,
};

function shouldSkipRewrite(specifier: string): boolean {
  return (
    specifier.startsWith("http://") ||
    specifier.startsWith("https://") ||
    specifier.startsWith("./") ||
    specifier.startsWith("../") ||
    specifier.startsWith("/") ||
    specifier.startsWith("@/") ||
    specifier.startsWith("veryfront")
  );
}

function isHtmlImportMapPackage(normalized: string): boolean {
  return HTML_IMPORT_MAP_PACKAGES.some(
    (pkg) => normalized === pkg || normalized.startsWith(`${pkg}/`),
  );
}

export function rewriteBareImports(code: string, _moduleServerUrl?: string): Promise<string> {
  return Promise.resolve(replaceSpecifiers(code, (specifier) => {
    // Check known import map first
    const mapped = REACT_IMPORT_MAP[specifier];
    if (mapped) return mapped;

    // Skip if already absolute URL, relative path, or local module path
    if (shouldSkipRewrite(specifier)) return null;

    // Normalize: strip inline version specifiers (e.g., tailwindcss@3.4.17 -> tailwindcss)
    const normalized = normalizeVersionedSpecifier(specifier);

    // Keep as bare specifier if HTML import map will resolve it
    if (isHtmlImportMapPackage(normalized)) return null;

    // Pin tailwindcss to unified version to prevent multiple versions loading
    let finalSpecifier = normalized;
    if (normalized === "tailwindcss" || normalized.startsWith("tailwindcss/")) {
      finalSpecifier = normalized.replace(/^tailwindcss/, `tailwindcss@${TAILWIND_VERSION}`);
    } else if (!hasVersionSpecifier(specifier)) {
      warnUnversionedImport(specifier);
    }

    // Convert remaining bare imports to esm.sh URLs with React externalized
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

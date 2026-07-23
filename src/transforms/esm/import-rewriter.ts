import { parseImports, replaceSpecifiers, rewriteImports } from "./lexer.ts";
import { getReactImportMap } from "./package-registry.ts";
import {
  DEFAULT_REACT_VERSION as REACT_DEFAULT_VERSION,
  TAILWIND_VERSION,
} from "#veryfront/transforms/import-rewriter/url-builder.ts";
import { rendererLogger } from "#veryfront/utils";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { sanitizeVendorExportName } from "../shared/vendor-export-name.ts";
import { parseBarePackageSpecifier } from "../shared/package-specifier.ts";

const logger = rendererLogger.component("esm");

export function addHMRTimestamps(code: string, timestamp: string | number): Promise<string> {
  return withSpan(
    "transforms.esm.addHMRTimestamps",
    () =>
      replaceSpecifiers(code, (specifier: string) => {
        const isLocalImport = specifier.startsWith("./") ||
          specifier.startsWith("../") ||
          specifier.startsWith("/") ||
          specifier.startsWith("@/");

        if (!isLocalImport) return null;
        if (specifier.startsWith("http://") || specifier.startsWith("https://")) return null;
        if (specifier.includes("?t=") || specifier.includes("&t=")) return null;

        const separator = specifier.includes("?") ? "&" : "?";
        return `${specifier}${separator}t=${timestamp}`;
      }),
    { "transforms.timestamp": String(timestamp) },
  );
}

/**
 * Track unversioned import warnings per-project to avoid cross-tenant warning suppression.
 * Key format: `${projectId}:${specifier}` for project-scoped deduplication.
 * @see plans/architecture-audit/011.1-global-warning-state-pollution.md
 */
const MAX_WARNED_ENTRIES = 10_000;
const unversionedImportsWarned = new Set<string>();

function hasVersionSpecifier(specifier: string): boolean {
  return /@[\d^~x][\d.x^~-]*(?=\/|$)/.test(specifier);
}

function warnUnversionedImport(specifier: string, projectId?: string): void {
  const key = projectId ? `${projectId}:${specifier}` : specifier;
  if (unversionedImportsWarned.has(key)) return;

  if (unversionedImportsWarned.size >= MAX_WARNED_ENTRIES) unversionedImportsWarned.clear();
  unversionedImportsWarned.add(key);

  const packageName = parseBarePackageSpecifier(specifier)?.packageName;

  logger.warn(
    "Unversioned import may cause reproducibility issues",
    packageName
      ? {
        package: packageName,
        suggestion: `Pin version: import '${packageName}@x.y.z'`,
        help: `Run 'npm info ${packageName} version' to find current version`,
      }
      : undefined,
  );
}

function normalizeVersionedSpecifier(specifier: string): string {
  return specifier.replace(/@[\d^~x][\d.x^~-]*(?=\/|$)/, "");
}

function shouldSkipRewrite(specifier: string): boolean {
  return (
    specifier.startsWith("http://") ||
    specifier.startsWith("https://") ||
    specifier.startsWith("./") ||
    specifier.startsWith("../") ||
    specifier.startsWith("/") ||
    specifier.startsWith("@/") ||
    specifier.startsWith("#") ||
    specifier.startsWith("veryfront")
  );
}

/** Rewrite legacy bare package imports to pinned runtime URLs. */
export function rewriteBareImports(
  code: string,
  _moduleServerUrl?: string,
  reactVersion?: string,
  projectId?: string,
): Promise<string> {
  const reactImportMap = getReactImportMap(reactVersion ?? REACT_DEFAULT_VERSION);

  return withSpan(
    "transforms.esm.rewriteBareImports",
    () =>
      replaceSpecifiers(code, (specifier) => {
        const mapped = reactImportMap[specifier];
        if (mapped) return mapped;

        if (shouldSkipRewrite(specifier)) return null;

        const normalized = normalizeVersionedSpecifier(specifier);

        let finalSpecifier = normalized;
        if (normalized === "tailwindcss" || normalized.startsWith("tailwindcss/")) {
          finalSpecifier = normalized.replace(/^tailwindcss/, `tailwindcss@${TAILWIND_VERSION}`);
        } else if (!hasVersionSpecifier(specifier)) {
          warnUnversionedImport(specifier, projectId);
        }

        return `https://esm.sh/${finalSpecifier}?external=react&target=es2022`;
      }),
    {
      "transforms.code_length": code.length,
    },
  );
}

const REACT_PACKAGES = new Set([
  "react",
  "react-dom",
  "react-dom/client",
  "react-dom/server",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
]);

/** Rewrite React imports to a configured browser vendor bundle. */
export function rewriteVendorImports(
  code: string,
  moduleServerUrl: string,
  vendorBundleHash: string,
): Promise<string> {
  return withSpan(
    "transforms.esm.rewriteVendorImports",
    async () => {
      const vendorUrl = `${moduleServerUrl}/_vendor.js?v=${vendorBundleHash}`;

      let result = await rewriteImports(code, (imp, statement) => {
        if (!imp.n || !REACT_PACKAGES.has(imp.n)) return null;

        const trimmed = statement.trimStart();
        if (!trimmed.startsWith("export")) return null;

        const specStart = imp.s - imp.ss;
        const specEnd = imp.e - imp.ss;
        return `${statement.slice(0, specStart)}${vendorUrl}${statement.slice(specEnd)}`;
      });

      const baseSource = result;
      const imports = await parseImports(baseSource);

      for (let i = imports.length - 1; i >= 0; i--) {
        const imp = imports[i];
        if (!imp?.n || !REACT_PACKAGES.has(imp.n)) continue;

        const exportName = sanitizeVendorExportName(imp.n);

        if (imp.d > -1) {
          const afterSpecifier = baseSource.substring(imp.e);
          const match = afterSpecifier.match(/^['"]\s*\)/);
          if (!match) continue;

          const endOfCall = imp.e + match[0].length;
          const replacement = `import('${vendorUrl}').then(m => m.${exportName})`;
          result = result.substring(0, imp.d) + replacement + result.substring(endOfCall);
          continue;
        }

        const beforeSpecifier = baseSource.substring(imp.ss, imp.s);
        const fromIndex = beforeSpecifier.lastIndexOf("from");

        if (fromIndex === -1) {
          result = result.substring(0, imp.ss) + `import '${vendorUrl}'` + result.substring(imp.se);
          continue;
        }

        const clause = beforeSpecifier.substring(6, fromIndex).trim();

        let replacement: string;
        if (clause.startsWith("*")) {
          replacement = `import ${clause} from '${vendorUrl}'`;
        } else if (clause.startsWith("{")) {
          replacement =
            `import { ${exportName} } from '${vendorUrl}'; const ${clause} = ${exportName}`;
        } else {
          replacement = `import { ${exportName} as ${clause} } from '${vendorUrl}'`;
        }

        result = result.substring(0, imp.ss) + replacement + result.substring(imp.se);
      }

      return result;
    },
    { "transforms.code_length": code.length, "transforms.vendor_hash": vendorBundleHash },
  );
}

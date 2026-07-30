import { parseImports, replaceSpecifiers, rewriteImports } from "./lexer.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { sanitizeVendorExportName } from "../shared/vendor-export-name.ts";

const MAX_HMR_TIMESTAMP_CODE_UNITS = 256;

export async function addHMRTimestamps(
  code: string,
  timestamp: string | number,
): Promise<string> {
  const timestampValue = String(timestamp);
  if (
    timestampValue.length === 0 ||
    timestampValue.length > MAX_HMR_TIMESTAMP_CODE_UNITS ||
    timestampValue !== timestampValue.trim()
  ) {
    throw new TypeError("HMR timestamp must be a bounded non-empty query identity");
  }

  let encodedTimestamp: string;
  try {
    encodedTimestamp = encodeURIComponent(timestampValue);
  } catch {
    throw new TypeError("HMR timestamp contains malformed text encoding");
  }

  return await withSpan(
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
        return `${specifier}${separator}t=${encodedTimestamp}`;
      }),
    { "transforms.timestamp": timestampValue },
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

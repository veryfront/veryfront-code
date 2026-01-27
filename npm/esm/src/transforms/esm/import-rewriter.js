import { parseImports, replaceSpecifiers, rewriteImports } from "./lexer.js";
import { REACT_DEFAULT_VERSION, TAILWIND_VERSION } from "../../utils/constants/cdn.js";
import { rendererLogger as logger } from "../../utils/index.js";
import { withSpan } from "../../observability/tracing/otlp-setup.js";
import { getReactImportMap } from "./package-registry.js";
export function addHMRTimestamps(code, timestamp) {
    return withSpan("transforms.esm.addHMRTimestamps", () => replaceSpecifiers(code, (specifier) => {
        const isLocalImport = specifier.startsWith("./") ||
            specifier.startsWith("../") ||
            specifier.startsWith("/") ||
            specifier.startsWith("@/");
        if (!isLocalImport)
            return null;
        if (specifier.includes("?t=") || specifier.includes("&t="))
            return null;
        if (specifier.startsWith("http://") || specifier.startsWith("https://"))
            return null;
        const separator = specifier.includes("?") ? "&" : "?";
        return `${specifier}${separator}t=${timestamp}`;
    }), { "transforms.timestamp": String(timestamp) });
}
const unversionedImportsWarned = new Set();
function hasVersionSpecifier(specifier) {
    return /@[\d^~x][\d.x^~-]*(?=\/|$)/.test(specifier);
}
function warnUnversionedImport(specifier) {
    if (unversionedImportsWarned.has(specifier))
        return;
    unversionedImportsWarned.add(specifier);
    const isScoped = specifier.startsWith("@");
    const parts = specifier.split("/");
    const packageName = isScoped ? parts.slice(0, 2).join("/") : (parts[0] ?? "");
    logger.warn("[ESM] Unversioned import may cause reproducibility issues", {
        import: specifier,
        suggestion: `Pin version: import '${packageName}@x.y.z'`,
        help: `Run 'npm info ${packageName} version' to find current version`,
    });
}
function normalizeVersionedSpecifier(specifier) {
    return specifier.replace(/@[\d^~x][\d.x^~-]*(?=\/|$)/, "");
}
function shouldSkipRewrite(specifier) {
    return (specifier.startsWith("http://") ||
        specifier.startsWith("https://") ||
        specifier.startsWith("./") ||
        specifier.startsWith("../") ||
        specifier.startsWith("/") ||
        specifier.startsWith("@/") ||
        specifier.startsWith("#") ||
        specifier.startsWith("veryfront"));
}
export function rewriteBareImports(code, _moduleServerUrl, reactVersion) {
    // Get React import map for the specified version (uses centralized URL builder)
    const reactImportMap = getReactImportMap(reactVersion ?? REACT_DEFAULT_VERSION);
    return withSpan("transforms.esm.rewriteBareImports", () => replaceSpecifiers(code, (specifier) => {
        const mapped = reactImportMap[specifier];
        if (mapped)
            return mapped;
        if (shouldSkipRewrite(specifier))
            return null;
        const normalized = normalizeVersionedSpecifier(specifier);
        let finalSpecifier = normalized;
        if (normalized === "tailwindcss" || normalized.startsWith("tailwindcss/")) {
            finalSpecifier = normalized.replace(/^tailwindcss/, `tailwindcss@${TAILWIND_VERSION}`);
        }
        else if (!hasVersionSpecifier(specifier)) {
            warnUnversionedImport(specifier);
        }
        return `https://esm.sh/${finalSpecifier}?external=react&target=es2022`;
    }), { "transforms.code_length": code.length });
}
const REACT_PACKAGES = new Set([
    "react",
    "react-dom",
    "react-dom/client",
    "react-dom/server",
    "react/jsx-runtime",
    "react/jsx-dev-runtime",
]);
export function rewriteVendorImports(code, moduleServerUrl, vendorBundleHash) {
    return withSpan("transforms.esm.rewriteVendorImports", async () => {
        const vendorUrl = `${moduleServerUrl}/_vendor.js?v=${vendorBundleHash}`;
        let result = await rewriteImports(code, (imp, statement) => {
            if (!imp.n || !REACT_PACKAGES.has(imp.n))
                return null;
            const trimmed = statement.trimStart();
            if (!trimmed.startsWith("export"))
                return null;
            const specStart = imp.s - imp.ss;
            const specEnd = imp.e - imp.ss;
            return `${statement.slice(0, specStart)}${vendorUrl}${statement.slice(specEnd)}`;
        });
        const baseSource = result;
        const imports = await parseImports(baseSource);
        for (let i = imports.length - 1; i >= 0; i--) {
            const imp = imports[i];
            if (!imp?.n || !REACT_PACKAGES.has(imp.n))
                continue;
            const exportName = sanitizeVendorExportName(imp.n);
            if (imp.d > -1) {
                const afterSpecifier = baseSource.substring(imp.e);
                const match = afterSpecifier.match(/^['"]\s*\)/);
                if (!match)
                    continue;
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
            let replacement;
            if (clause.startsWith("*")) {
                replacement = `import ${clause} from '${vendorUrl}'`;
            }
            else if (clause.startsWith("{")) {
                replacement =
                    `import { ${exportName} } from '${vendorUrl}'; const ${clause} = ${exportName}`;
            }
            else {
                replacement = `import { ${exportName} as ${clause} } from '${vendorUrl}'`;
            }
            result = result.substring(0, imp.ss) + replacement + result.substring(imp.se);
        }
        return result;
    }, { "transforms.code_length": code.length, "transforms.vendor_hash": vendorBundleHash });
}
function sanitizeVendorExportName(pkg) {
    return pkg
        .replace(/^@/, "")
        .replace(/[\/\-]/g, "_")
        .replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
        .replace(/^_/, "");
}

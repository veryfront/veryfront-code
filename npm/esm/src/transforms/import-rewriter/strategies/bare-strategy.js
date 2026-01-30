/**
 * Bare npm import rewriting strategy.
 *
 * Priority: 2
 * Handles: lodash, @tanstack/react-query, etc.
 */
import { rendererLogger as logger } from "../../../utils/index.js";
import { buildEsmShUrl, TAILWIND_VERSION } from "../url-builder.js";
// Track unversioned import warnings per-project
const unversionedImportsWarned = new Set();
function hasVersionSpecifier(specifier) {
    return /@[\d^~x][\d.x^~-]*(?=\/|$)/.test(specifier);
}
function normalizeVersionedSpecifier(specifier) {
    return specifier.replace(/@[\d^~x][\d.x^~-]*(?=\/|$)/, "");
}
function warnUnversionedImport(specifier, projectId) {
    const key = `${projectId}:${specifier}`;
    if (unversionedImportsWarned.has(key))
        return;
    unversionedImportsWarned.add(key);
    const isScoped = specifier.startsWith("@");
    const parts = specifier.split("/");
    const packageName = isScoped ? parts.slice(0, 2).join("/") : (parts[0] ?? "");
    logger.warn("[ESM] Unversioned import may cause reproducibility issues", {
        import: specifier,
        projectId,
        suggestion: `Pin version: import '${packageName}@x.y.z'`,
        help: `Run 'npm info ${packageName} version' to find current version`,
    });
}
export class BareStrategy {
    name = "bare";
    priority = 2;
    matches(specifier, _ctx) {
        // Skip imports already handled by other strategies
        if (specifier.startsWith("http://") ||
            specifier.startsWith("https://") ||
            specifier.startsWith("./") ||
            specifier.startsWith("../") ||
            specifier.startsWith("/") ||
            specifier.startsWith("@/") ||
            specifier.startsWith("#") ||
            specifier.startsWith("veryfront") ||
            specifier.startsWith("@veryfront") ||
            specifier === "react" ||
            specifier === "react-dom" ||
            specifier.startsWith("react/") ||
            specifier.startsWith("react-dom/")) {
            return false;
        }
        // Node.js built-in modules - handled separately
        if (specifier.startsWith("node:")) {
            return false;
        }
        return true;
    }
    rewrite(info, ctx) {
        // For SSR, use import map (handled by ImportMapStrategy)
        // This strategy only handles browser transforms
        if (ctx.target === "ssr") {
            return { specifier: null };
        }
        const normalized = normalizeVersionedSpecifier(info.specifier);
        let finalSpecifier = normalized;
        // Handle tailwindcss specially
        if (normalized === "tailwindcss" || normalized.startsWith("tailwindcss/")) {
            finalSpecifier = normalized.replace(/^tailwindcss/, `tailwindcss@${TAILWIND_VERSION}`);
        }
        else if (!hasVersionSpecifier(info.specifier)) {
            warnUnversionedImport(info.specifier, ctx.projectId);
        }
        // Build esm.sh URL
        const url = buildEsmShUrl(finalSpecifier, undefined, undefined, {
            external: ["react"],
        });
        return { specifier: url };
    }
}
export const bareStrategy = new BareStrategy();

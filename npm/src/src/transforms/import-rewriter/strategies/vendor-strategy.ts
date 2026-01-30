/**
 * Vendor bundle rewriting strategy.
 *
 * Priority: 6
 * Handles: Rewriting React imports to use vendor bundle (browser only)
 */

import type {
  ImportRewriteStrategy,
  ImportSpecifierInfo,
  RewriteContext,
  RewriteResult,
} from "../types.js";
import { buildModuleServerUrl } from "../url-builder.js";

const REACT_PACKAGES = new Set([
  "react",
  "react-dom",
  "react-dom/client",
  "react-dom/server",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
]);

function sanitizeVendorExportName(pkg: string): string {
  return pkg
    .replace(/^@/, "")
    .replace(/[/-]/g, "_")
    .replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())
    .replace(/^_/, "");
}

export class VendorStrategy implements ImportRewriteStrategy {
  readonly name = "vendor";
  readonly priority = 6;

  matches(specifier: string, ctx: RewriteContext): boolean {
    // Only handle browser transforms with vendor bundle configured
    if (ctx.target !== "browser") return false;
    if (!ctx.vendorBundleHash || !ctx.moduleServerUrl) return false;

    return REACT_PACKAGES.has(specifier);
  }

  rewrite(info: ImportSpecifierInfo, ctx: RewriteContext): RewriteResult {
    if (!ctx.vendorBundleHash || !ctx.moduleServerUrl) {
      return { specifier: null };
    }

    const vendorUrl = buildModuleServerUrl(
      ctx.moduleServerUrl,
      `_vendor.js?v=${ctx.vendorBundleHash}`,
    );

    // For dynamic imports, wrap in promise
    if (info.isDynamic) {
      const exportName = sanitizeVendorExportName(info.specifier);
      return {
        specifier: null,
        statement: `import('${vendorUrl}').then(m => m.${exportName})`,
      };
    }

    // Simple specifier rewrite - just change the specifier to vendor URL
    return {
      specifier: vendorUrl,
    };
  }
}

export const vendorStrategy = new VendorStrategy();

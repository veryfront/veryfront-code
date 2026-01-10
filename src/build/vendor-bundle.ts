/**
 * Vendor Bundle Builder
 *
 * Creates per-project vendor bundles containing React and third-party dependencies.
 * Ensures single React instance across SSR and dynamic imports.
 */

import * as esbuild from "esbuild/mod.js"; // Native esbuild
import { createError, toError } from "../core/errors/veryfront-error.ts";

export interface VendorBundleConfig {
  /** Project identifier for cache isolation */
  projectId: string;
  /** React version to bundle */
  reactVersion: string;
  /** Third-party dependencies to include */
  dependencies: Record<string, string>;
  /** Development mode */
  dev?: boolean;
}

export interface VendorBundleResult {
  /** Bundle code */
  code: string;
  /** Content hash for caching */
  hash: string;
  /** Export map: import specifier -> export name */
  exports: Record<string, string>;
}

/**
 * Build vendor bundle containing React and third-party packages
 *
 * Strategy:
 * 1. Create virtual entry point that imports all dependencies
 * 2. Bundle with esbuild (format: esm, platform: browser)
 * 3. Mark nothing as external (bundle everything)
 * 4. Return bundle code with export map
 *
 * @param config Vendor bundle configuration
 * @returns Vendor bundle result
 */
export async function buildVendorBundle(
  config: VendorBundleConfig,
): Promise<VendorBundleResult> {
  const { reactVersion, dependencies, dev = true } = config;

  // Build import map for React
  const reactImports = {
    "react": `https://esm.sh/react@${reactVersion}?pin=v135`,
    "react-dom": `https://esm.sh/react-dom@${reactVersion}?pin=v135`,
    "react-dom/server": `https://esm.sh/react-dom@${reactVersion}/server?pin=v135`,
    "react-dom/client": `https://esm.sh/react-dom@${reactVersion}/client?pin=v135`,
    "react/jsx-runtime": `https://esm.sh/react@${reactVersion}/jsx-runtime?pin=v135`,
    "react/jsx-dev-runtime": `https://esm.sh/react@${reactVersion}/jsx-dev-runtime?pin=v135`,
  };

  // Build import map for third-party dependencies
  const thirdPartyImports: Record<string, string> = {};
  for (const [pkg, version] of Object.entries(dependencies)) {
    // Use ESM.sh with ?external=react to prevent bundling React inside third-party packages
    thirdPartyImports[pkg] = `https://esm.sh/${pkg}@${version}?external=react,react-dom&pin=v135`;
  }

  // Create virtual entry point
  const entryPoint = createVirtualEntry({
    ...reactImports,
    ...thirdPartyImports,
  });

  // Bundle with esbuild
  const result = await esbuild.build({
    stdin: {
      contents: entryPoint,
      loader: "js",
    },
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2020",
    minify: !dev,
    sourcemap: dev ? "inline" : false,
    treeShaking: true,
    write: false,
  });

  if (result.outputFiles.length === 0) {
    throw toError(createError({
      type: "build",
      message: "Vendor bundle build produced no output",
    }));
  }

  const code = new TextDecoder().decode(result.outputFiles[0]!.contents);

  // Compute content hash
  const hash = await computeHash(code);

  // Build export map
  const exports = Object.fromEntries(
    Object.keys({ ...reactImports, ...thirdPartyImports }).map((key) => [key, sanitizeExportName(key)]),
  );

  return { code, hash, exports };
}

/**
 * Create virtual entry point that imports and re-exports all dependencies
 *
 * Example output:
 * ```js
 * import * as react from 'https://esm.sh/react@18.3.1'
 * import * as reactDom from 'https://esm.sh/react-dom@18.3.1'
 * export { react, reactDom }
 * ```
 */
function createVirtualEntry(imports: Record<string, string>): string {
  const lines: string[] = [];

  // Import statements
  for (const [specifier, url] of Object.entries(imports)) {
    const exportName = sanitizeExportName(specifier);
    lines.push(`import * as ${exportName} from '${url}';`);
  }

  // Export statement
  const exportNames = Object.keys(imports).map(sanitizeExportName);

  lines.push(`export { ${exportNames.join(", ")} };`);

  return lines.join("\n");
}

/**
 * Sanitize import specifier to valid export name
 *
 * Examples:
 * - 'react' -> 'react'
 * - 'react-dom' -> 'reactDom'
 * - 'react/jsx-runtime' -> 'reactJsxRuntime'
 * - '@radix-ui/react-dialog' -> 'radixUiReactDialog'
 */
function sanitizeExportName(specifier: string): string {
  return specifier
    .replace(/^@/, "") // Remove @ prefix
    .replace(/[\/\-]/g, "_") // Replace / and - with _
    .replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()) // camelCase
    .replace(/^_/, ""); // Remove leading underscore
}

/**
 * Compute SHA-256 hash of content
 */
async function computeHash(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .substring(0, 16);
}

/**
 * Vendor Bundle Builder
 *
 * Creates per-project vendor bundles containing React and third-party dependencies.
 * Ensures single React instance across SSR and dynamic imports.
 */

import * as esbuild from "esbuild"; // Native esbuild
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";

interface VendorBundleConfig {
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
async function buildVendorBundle(
  config: VendorBundleConfig,
): Promise<VendorBundleResult> {
  const { reactVersion, dependencies, dev = true } = config;

  const reactImports: Record<string, string> = {
    react: `https://esm.sh/react@${reactVersion}?pin=v135`,
    "react-dom": `https://esm.sh/react-dom@${reactVersion}?pin=v135`,
    "react-dom/server": `https://esm.sh/react-dom@${reactVersion}/server?pin=v135`,
    "react-dom/client": `https://esm.sh/react-dom@${reactVersion}/client?pin=v135`,
    "react/jsx-runtime": `https://esm.sh/react@${reactVersion}/jsx-runtime?pin=v135`,
    "react/jsx-dev-runtime": `https://esm.sh/react@${reactVersion}/jsx-dev-runtime?pin=v135`,
  };

  const thirdPartyImports = Object.fromEntries(
    Object.entries(dependencies).map(([pkg, version]) => [
      pkg,
      `https://esm.sh/${pkg}@${version}?external=react&pin=v135`,
    ]),
  );

  const imports = { ...reactImports, ...thirdPartyImports };
  const entryPoint = createVirtualEntry(imports);

  const result = await esbuild.build({
    stdin: { contents: entryPoint, loader: "js" },
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2020",
    minify: !dev,
    sourcemap: dev ? "inline" : false,
    treeShaking: true,
    write: false,
  });

  const output = result.outputFiles?.[0];
  if (!output) {
    throw toError(
      createError({
        type: "build",
        message: "Vendor bundle build produced no output",
      }),
    );
  }

  const code = new TextDecoder().decode(output.contents);
  const hash = await computeHash(code);

  return {
    code,
    hash,
    exports: Object.fromEntries(
      Object.keys(imports).map((key) => [key, sanitizeExportName(key)]),
    ),
  };
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
  const importLines: string[] = [];
  const exportNames: string[] = [];

  for (const [specifier, url] of Object.entries(imports)) {
    const exportName = sanitizeExportName(specifier);
    importLines.push(`import * as ${exportName} from '${url}';`);
    exportNames.push(exportName);
  }

  return [...importLines, `export { ${exportNames.join(", ")} };`].join("\n");
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
    .replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()) // camelCase
    .replace(/^_/, ""); // Remove leading underscore
}

/**
 * Compute SHA-256 hash of content
 */
async function computeHash(content: string): Promise<string> {
  const data = new TextEncoder().encode(content);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);

  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

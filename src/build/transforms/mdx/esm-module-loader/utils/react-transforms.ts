/**
 * React Import Transforms
 *
 * Transforms React imports to absolute file:// paths for Node.js.
 * Required because MDX modules are cached in arbitrary directories
 * (like temp dirs) where Node.js cannot resolve bare 'react' imports.
 *
 * @module build/transforms/mdx/esm-module-loader/utils/react-transforms
 */

import { IS_TRUE_NODE } from "../constants.ts";

// Cache for resolved react package paths (Node.js only)
const _resolvedPaths: Record<string, string | null> = {};

/**
 * Resolve a Node.js package path using require.resolve.
 * Returns null if resolution fails.
 */
export async function resolveNodePackage(packageSpec: string): Promise<string | null> {
  if (!IS_TRUE_NODE) return null;
  if (packageSpec in _resolvedPaths) return _resolvedPaths[packageSpec]!;

  try {
    // Use Node.js createRequire to resolve the package from THIS file's location
    // This ensures react is found from veryfront's node_modules, not the project's
    const { createRequire } = await import("node:module");
    const require = createRequire(import.meta.url);
    const resolved = require.resolve(packageSpec);
    _resolvedPaths[packageSpec] = resolved;
    return resolved;
  } catch {
    _resolvedPaths[packageSpec] = null;
    return null;
  }
}

/**
 * Transform react imports to absolute file:// paths for Node.js.
 * This is needed because MDX modules are cached in temp directories
 * where Node.js cannot resolve bare imports.
 */
export async function transformReactImportsToAbsolute(code: string): Promise<string> {
  if (!IS_TRUE_NODE) return code;

  // Resolve the actual react package paths
  const reactPath = await resolveNodePackage("react");
  const reactJsxPath = await resolveNodePackage("react/jsx-runtime");
  const reactJsxDevPath = await resolveNodePackage("react/jsx-dev-runtime");
  const reactDomPath = await resolveNodePackage("react-dom");

  let result = code;

  // Replace bare react imports with absolute file:// paths
  if (reactJsxPath) {
    result = result.replace(
      /from\s+['"]react\/jsx-runtime['"]/g,
      `from "file://${reactJsxPath}"`,
    );
  }
  if (reactJsxDevPath) {
    result = result.replace(
      /from\s+['"]react\/jsx-dev-runtime['"]/g,
      `from "file://${reactJsxDevPath}"`,
    );
  }
  if (reactDomPath) {
    result = result.replace(
      /from\s+['"]react-dom['"]/g,
      `from "file://${reactDomPath}"`,
    );
  }
  if (reactPath) {
    result = result.replace(
      /from\s+['"]react['"]/g,
      `from "file://${reactPath}"`,
    );
  }

  return result;
}

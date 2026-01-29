/**
 * JSX/TypeScript Transform Utility
 *
 * Uses native esbuild for all transforms. In deno compile environments,
 * the esbuild binary is extracted from VFS to /tmp at startup.
 * @see ./esbuild.ts for VFS extraction logic
 */

import { getEsbuild, initializeEsbuild } from "./esbuild.ts";

let esbuildInitialized = false;

export interface TransformResult {
  code: string;
}

export interface TransformOptions {
  loader?: "tsx" | "jsx" | "ts" | "js";
}

/**
 * Transform JSX/TSX source to JavaScript using native esbuild.
 */
export async function transformJsx(
  source: string,
  options: TransformOptions = {},
): Promise<TransformResult> {
  const loader = options.loader ?? "tsx";

  const esbuild = await getEsbuild();

  const result = await esbuild.transform(source, {
    loader,
    jsx: "automatic",
    jsxImportSource: "react",
    format: "esm",
    target: "es2020",
  });

  return { code: result.code };
}

/**
 * Initialize the transform system.
 * Call at server startup to ensure esbuild binary is available.
 */
export async function initializeTransform(): Promise<void> {
  if (esbuildInitialized) return;
  await initializeEsbuild();
  esbuildInitialized = true;
}

/**
 * Check if we're using esbuild (always true now - sucrase fallback removed)
 */
export function isUsingEsbuild(): boolean {
  return true;
}

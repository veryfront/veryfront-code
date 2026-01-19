/**
 * Portable esbuild import for cross-runtime compatibility.
 *
 * Uses "esbuild" import which works in all runtimes:
 * - Deno: via import map → npm:esbuild
 * - Node.js/Bun: native npm package
 *
 * @module
 */

export type { BuildOptions, BuildResult, TransformOptions, TransformResult } from "esbuild";

let _esbuild: typeof import("esbuild") | null = null;

/**
 * Get the esbuild module, loading it lazily if needed.
 */
export async function getEsbuild(): Promise<typeof import("esbuild")> {
  if (_esbuild) return _esbuild;
  _esbuild = await import("esbuild");
  return _esbuild;
}

/**
 * Transform code using esbuild.
 */
export async function transform(
  code: string,
  options?: import("esbuild").TransformOptions,
): Promise<import("esbuild").TransformResult> {
  const esbuild = await getEsbuild();
  return esbuild.transform(code, options);
}

/**
 * Build with esbuild.
 */
export async function build(
  options: import("esbuild").BuildOptions,
): Promise<import("esbuild").BuildResult> {
  const esbuild = await getEsbuild();
  return esbuild.build(options);
}

/**
 * Stop esbuild service.
 */
export async function stop(): Promise<void> {
  const esbuild = await getEsbuild();
  await esbuild.stop();
}

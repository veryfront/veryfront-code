/**
 * ESBuild Bundler
 *
 * Bundles TypeScript/JSX files on-the-fly for development.
 * Uses esbuild for fast compilation with React JSX automatic runtime.
 *
 * @module server/handlers/dev/files/esbuild-bundler
 */

import type { HandlerContext } from "../../types.ts";
import type { BuildResult } from "esbuild";
import { getDirectory, getEsbuildLoader } from "#veryfront/utils/path-utils.ts";
import { createBareExternalPlugin, createRelativeFsPlugin } from "./esbuild-plugins.ts";

/**
 * Bundle a file with esbuild
 *
 * Features:
 * - Automatic JSX runtime (React 17+)
 * - TypeScript/TSX support
 * - ES modules output
 * - Browser platform target
 * - External React dependencies
 * - Relative import resolution
 * - Bare module externalization
 *
 * @param absPath - Absolute path to file to bundle
 * @param ctx - Handler context with adapter for file system access
 * @returns Bundled JavaScript code
 *
 * @example
 * ```typescript
 * const code = await bundleDevFile('/project/app/page.tsx', ctx);
 * // Returns: "import { jsx } from 'react/jsx-runtime'; ..."
 * ```
 */
export async function bundleDevFile(
  absPath: string,
  ctx: HandlerContext,
): Promise<string> {
  const { build } = await import("esbuild");
  const src = await ctx.adapter.fs.readFile(absPath);

  const result: BuildResult = await build({
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2020",
    jsx: "automatic",
    jsxImportSource: "react",
    external: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
    stdin: {
      contents: src,
      loader: getEsbuildLoader(absPath),
      resolveDir: getDirectory(absPath),
      sourcefile: absPath,
    },
    plugins: [
      createRelativeFsPlugin(ctx.projectDir, ctx.adapter),
      createBareExternalPlugin(),
    ],
  });

  const code = result.outputFiles?.[0]?.text ?? "export default null";
  return code;
}

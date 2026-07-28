/****
 * ESBuild context creation and configuration
 * @module code-splitter/build-context
 */

import { type BuildContext, context } from "veryfront/extensions/bundler";
import { join } from "#veryfront/compat/path/index.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { getReactImportMap, REACT_DEFAULT_VERSION } from "#veryfront/utils";
import { createSplitterPlugin } from "./esbuild-plugin.ts";
import type { SplitOptions } from "./types.ts";
import { isNotFoundError } from "#veryfront/platform/compat/fs.ts";

/** Veryfront client modules that may be externalized based on moduleResolution setting */
const VERYFRONT_CLIENT_MODULES = [
  "veryfront/chat",
  "veryfront/markdown",
  "veryfront/mdx",
  "veryfront/workflow",
];

/** Gets list of external dependencies to exclude from bundle */
export function getExternalDependencies(
  customExternal: string[] = [],
  moduleResolution: "cdn" | "self-hosted" | "bundled" = "cdn",
): string[] {
  const external = [
    "react",
    "react-dom",
    "react-dom/client",
    "react/jsx-runtime",
    "react/jsx-dev-runtime",
  ];

  if (moduleResolution !== "bundled") {
    external.push(...VERYFRONT_CLIENT_MODULES);
  }

  external.push(...customExternal);
  return [...new Set(external)];
}

/** Creates a browser shim file for global compatibility */
export async function createShimFile(outDir: string): Promise<string> {
  const shimPath = join(outDir, `.veryfront-shim-${crypto.randomUUID()}.js`);
  const reactImports = JSON.stringify(getReactImportMap(REACT_DEFAULT_VERSION));
  const shimContent = `
if (typeof global === 'undefined') {
  window.global = window;
}
if (typeof process === 'undefined') {
  window.process = { env: {} };
}

if (typeof window !== 'undefined' && !window.__veryfront_react_imports) {
  window.__veryfront_react_imports = ${reactImports};
}
`;

  await createFileSystem().writeTextFile(shimPath, shimContent);
  return shimPath;
}

/** Creates an ESBuild context with code splitting configuration */
export async function createBuildContext(
  options: SplitOptions,
  entryPoints: Record<string, string>,
): Promise<BuildContext> {
  const moduleResolution = options.moduleResolution ?? "cdn";
  const external = getExternalDependencies(options.external, moduleResolution);
  const shimFile = await createShimFile(options.outDir);

  const isProduction = options.mode === "production";
  const isDevelopment = options.mode === "development";

  const fs = createFileSystem();
  const removeShim = async (): Promise<void> => {
    try {
      await fs.remove(shimFile);
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
    }
  };

  let delegate: BuildContext;
  try {
    delegate = await context({
      entryPoints,
      bundle: true,
      splitting: true,
      format: "esm",
      target: ["es2022"],
      platform: "browser",
      outdir: options.outDir,
      metafile: true,
      minify: isProduction,
      sourcemap: isDevelopment,
      treeShaking: isProduction,
      chunkNames: "chunks/[name]-[hash]",
      entryNames: "[name]",
      assetNames: "assets/[name]-[hash]",
      external,
      inject: [shimFile],
      define: {
        "process.env.NODE_ENV": JSON.stringify(options.mode),
        __DEV__: JSON.stringify(isDevelopment),
      },
      plugins: [createSplitterPlugin(options.projectDir, [shimFile])],
    });
  } catch (error) {
    try {
      await removeShim();
    } catch {
      // Preserve the context-creation failure as the primary error.
    }
    throw error;
  }

  let disposed = false;
  return {
    rebuild: () => delegate.rebuild(),
    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;

      let disposeError: unknown;
      try {
        await delegate.dispose();
      } catch (error) {
        disposeError = error;
      }

      let cleanupError: unknown;
      try {
        await removeShim();
      } catch (error) {
        cleanupError = error;
      }

      if (disposeError !== undefined) throw disposeError;
      if (cleanupError !== undefined) throw cleanupError;
    },
  };
}

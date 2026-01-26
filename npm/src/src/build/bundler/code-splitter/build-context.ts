/****
 * ESBuild context creation and configuration
 * @module code-splitter/build-context
 */

import { type BuildContext, context } from "esbuild";
import { join } from "../../../platform/compat/path/index.js";
import { createFileSystem } from "../../../platform/compat/fs.js";
import { getReactImportMap, REACT_DEFAULT_VERSION } from "../../../utils/index.js";
import { createSplitterPlugin } from "./esbuild-plugin.js";
import type { SplitOptions } from "./types.js";

/** Veryfront client modules that may be externalized based on moduleResolution setting */
const VERYFRONT_CLIENT_MODULES = [
  "veryfront/agent/react",
  "veryfront/components/ai",
  "veryfront/primitives",
];

/** Gets list of external dependencies to exclude from bundle */
export function getExternalDependencies(
  customExternal: string[] = [],
  moduleResolution: "cdn" | "self-hosted" | "bundled" = "cdn",
): string[] {
  const baseExternal = [
    "react",
    "react-dom",
    "react-dom/client",
    "react/jsx-runtime",
    "react/jsx-dev-runtime",
  ];

  if (moduleResolution !== "bundled") {
    baseExternal.push(...VERYFRONT_CLIENT_MODULES);
  }

  return [...baseExternal, ...customExternal];
}

/** Creates a browser shim file for global compatibility */
export async function createShimFile(outDir: string): Promise<string> {
  const shimPath = join(outDir, ".veryfront-shim.js");
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
  const externalDependencies = getExternalDependencies(
    options.external,
    moduleResolution,
  );
  const shimFile = await createShimFile(options.outDir);

  return context({
    entryPoints,
    bundle: true,
    splitting: true,
    format: "esm",
    target: ["es2022"],
    platform: "browser",
    outdir: options.outDir,
    metafile: true,
    minify: options.mode === "production",
    sourcemap: options.mode === "development",
    treeShaking: options.mode === "production",
    chunkNames: "chunks/[name]-[hash]",
    entryNames: "[name]",
    assetNames: "assets/[name]-[hash]",
    external: externalDependencies,
    inject: [shimFile],
    define: {
      "process.env.NODE_ENV": JSON.stringify(options.mode),
      __DEV__: JSON.stringify(options.mode === "development"),
    },
    plugins: [createSplitterPlugin(options.projectDir)],
  });
}

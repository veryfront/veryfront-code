/**
 * ESBuild context creation and configuration
 * @module code-splitter/build-context
 */

import { type BuildContext, context } from "esbuild/mod.js";
import { join } from "@veryfront/platform/compat/path/index.ts";
import { getReactImportMap, REACT_DEFAULT_VERSION } from "@veryfront/utils";
import type { SplitOptions } from "./types.ts";
import { createSplitterPlugin } from "./esbuild-plugin.ts";
import { createFileSystem } from "@veryfront/platform/compat/fs.ts";

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

  // In 'bundled' mode, veryfront client modules are NOT external (bundled into client JS)
  // In 'cdn' or 'self-hosted' mode, they ARE external (resolved via import map)
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

  const fs = createFileSystem();
  await fs.writeTextFile(shimPath, shimContent);
  return shimPath;
}

/** Creates an ESBuild context with code splitting configuration */
export async function createBuildContext(
  options: SplitOptions,
  entryPoints: Record<string, string>,
): Promise<BuildContext> {
  const externalDependencies = getExternalDependencies(
    options.external,
    options.moduleResolution ?? "cdn",
  );
  const shimFile = await createShimFile(options.outDir);

  return await context({
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

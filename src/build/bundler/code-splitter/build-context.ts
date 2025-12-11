
import { type BuildContext, context } from "esbuild/mod.js";
import { join } from "std/path/mod.ts";
import { getReactImportMap, REACT_DEFAULT_VERSION } from "@veryfront/utils";
import type { SplitOptions } from "./types.ts";
import { createSplitterPlugin } from "./esbuild-plugin.ts";
import { createFileSystem } from "../../../platform/compat/fs.ts";

const VERYFRONT_AI_MODULES = [
  "veryfront/ai/react",
  "veryfront/ai/components",
  "veryfront/ai/primitives",
];

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
    baseExternal.push(...VERYFRONT_AI_MODULES);
  }

  return [...baseExternal, ...customExternal];
}

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

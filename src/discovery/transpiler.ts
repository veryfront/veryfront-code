/**
 * Module Transpiler
 *
 * Handles transpilation and bundling of TypeScript modules
 * for dynamic import during discovery.
 */

import type { Plugin, PluginBuild } from "veryfront/extensions/bundler";
import { isDeno, isDenoCompiled } from "#veryfront/platform/compat/runtime.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import * as pathHelper from "#veryfront/compat/path";
import { getEsbuildLoader } from "#veryfront/utils/path-utils.ts";
import type { FileSystemAdapter } from "#veryfront/platform/adapters/base.ts";
import type { FileDiscoveryContext } from "./types.ts";
import {
  DISCOVERY_GLOBAL_VERYFRONT_MODULES,
  rewriteDiscoveryImports,
  rewriteForDeno,
} from "./import-rewriter.ts";
import { COMPILATION_ERROR, FILE_NOT_FOUND } from "#veryfront/errors/error-registry.ts";
import { wrapWithCurrentContext } from "#veryfront/platform/adapters/fs/veryfront/request-context.ts";
// Static imports ensure deno compile includes public discovery modules in the binary.
import * as agentMod from "#veryfront/agent";
import * as toolMod from "#veryfront/tool";
import * as platformMod from "#veryfront/platform";
import * as promptMod from "#veryfront/prompt";
import * as resourceMod from "#veryfront/resource";
import * as embeddingMod from "#veryfront/embedding/index.ts";
import * as knowledgeMod from "#veryfront/knowledge";
import * as workflowMod from "#veryfront/workflow";
import * as workMod from "#veryfront/work";
import * as evalMod from "#veryfront/eval";
import * as metricsMod from "#veryfront/metrics";
import * as schemasMod from "#veryfront/schemas";
import * as chatUploadsMod from "#veryfront/chat/uploads";

const transpileCache = new Map<string, unknown>();

// Setup veryfront modules as globals for compiled binary support
let veryfrontGlobalsInitialized = false;

/**
 * Ensure veryfront modules are available as globals for compiled binaries
 */
async function ensureVeryfrontGlobals(): Promise<void> {
  if (veryfrontGlobalsInitialized || !isDenoCompiled) return;

  const modules = {
    "veryfront/agent": agentMod,
    "veryfront/tool": toolMod,
    "veryfront/platform": platformMod,
    "veryfront/prompt": promptMod,
    "veryfront/resource": resourceMod,
    "veryfront/embedding": embeddingMod,
    "veryfront/knowledge": knowledgeMod,
    "veryfront/workflow": workflowMod,
    "veryfront/work": workMod,
    "veryfront/eval": evalMod,
    "veryfront/metrics": metricsMod,
    "veryfront/schemas": schemasMod,
    "veryfront/chat/uploads": chatUploadsMod,
  } satisfies Record<(typeof DISCOVERY_GLOBAL_VERYFRONT_MODULES)[number], unknown>;

  (globalThis as Record<string, unknown>).__VERYFRONT_MODULES__ = modules;

  veryfrontGlobalsInitialized = true;
}

/**
 * Create an esbuild plugin for resolving files via fsAdapter
 */
function createFsAdapterPlugin(fsAdapter: FileSystemAdapter): Plugin {
  const existsCache = new Map<string, boolean>();

  async function checkExists(filePath: string): Promise<boolean> {
    const cached = existsCache.get(filePath);
    if (cached !== undefined) return cached;

    const exists = await fsAdapter.exists(filePath);
    existsCache.set(filePath, exists);
    return exists;
  }

  async function resolveWithExtensions(basePath: string): Promise<string | null> {
    if (/\.(ts|tsx|js|jsx|mjs|json)$/i.test(basePath)) {
      return (await checkExists(basePath)) ? basePath : null;
    }

    const extensions = [".ts", ".tsx", ".js", ".jsx", ".mjs"];

    for (const ext of extensions) {
      const fullPath = basePath + ext;
      if (await checkExists(fullPath)) return fullPath;
    }

    for (const ext of extensions) {
      const indexPath = pathHelper.join(basePath, `index${ext}`);
      if (await checkExists(indexPath)) return indexPath;
    }

    return null;
  }

  return {
    name: "veryfront-fsadapter",
    setup(build: PluginBuild) {
      // Wrap callbacks with wrapWithCurrentContext to preserve the
      // MultiProjectFSAdapter AsyncLocalStorage context across esbuild's
      // child-process message boundary. Without this, fsAdapter.exists()
      // and fsAdapter.readFile() cannot resolve the per-project adapter.
      build.onResolve(
        { filter: /^\.\.?\// },
        wrapWithCurrentContext(async (args) => {
          const importerDir = args.importer ? pathHelper.dirname(args.importer) : args.resolveDir;
          const basePath = pathHelper.resolve(importerDir, args.path);

          const resolvedPath = await resolveWithExtensions(basePath);
          if (resolvedPath) return { path: resolvedPath, namespace: "fsadapter" };

          return {
            errors: [
              {
                text: `Could not resolve "${args.path}" from "${importerDir}" via fsAdapter`,
              },
            ],
          };
        }),
      );

      build.onLoad(
        { filter: /.*/, namespace: "fsadapter" },
        wrapWithCurrentContext(async (args) => {
          try {
            const content = await fsAdapter.readFile(args.path);
            return {
              contents: content,
              loader: getEsbuildLoader(args.path),
              resolveDir: pathHelper.dirname(args.path),
            };
          } catch (error) {
            return {
              errors: [
                {
                  text: `Failed to load "${args.path}" from fsAdapter: ${error}`,
                },
              ],
            };
          }
        }),
      );
    },
  };
}

/**
 * Import and transpile a module for discovery
 */
export async function importModule(
  file: string,
  context: FileDiscoveryContext,
): Promise<unknown> {
  const cached = transpileCache.get(file);
  if (cached) return cached;

  // Ensure veryfront modules are available as globals for compiled binaries
  await ensureVeryfrontGlobals();

  const filePath = file.replace("file://", "");

  let source: string;
  try {
    source = context.fsAdapter
      ? await context.fsAdapter.readFile(filePath)
      : await createFileSystem().readTextFile(filePath);
  } catch (error) {
    throw FILE_NOT_FOUND.create({
      detail: `Failed to read file ${filePath}: ${error}`,
      cause: error,
    });
  }

  const loader = getEsbuildLoader(filePath);
  const { build } = await import("veryfront/extensions/bundler");
  const fileDir = pathHelper.dirname(filePath);

  // When using fsAdapter (VFS), bundle all relative imports via the plugin.
  // Only mark relative imports as external when running in Deno without VFS
  // (local filesystem where Deno can resolve them natively).
  const hasFsAdapter = !!context.fsAdapter;
  const relativeImports = isDeno && !isDenoCompiled && !hasFsAdapter
    ? [...source.matchAll(/from\s+["'](\.\.[^"']+)["']/g)].map((m) => m[1]!).filter(Boolean)
    : [];

  // Use fsAdapter plugin whenever a VFS adapter is available (regardless of runtime)
  const plugins = hasFsAdapter ? [createFsAdapterPlugin(context.fsAdapter!)] : [];

  const result = await build({
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    jsx: "automatic",
    jsxImportSource: "react",
    resolveExtensions: [".ts", ".tsx", ".js", ".jsx", ".mjs"],
    plugins,
    // Externalize all bare-specifier imports so npm packages a tool/agent file
    // depends on (e.g. `pdf-parse`, `mammoth`) are not pulled into the
    // discovery bundle. Discovery only needs the module's exports; the
    // implementation runs server-side at request time and can resolve npm
    // packages natively via the project's node_modules / import map.
    // Without this, esbuild under platform: "neutral" tries to bundle CJS
    // npm packages and fails on their Node built-in references (fs, http, ...).
    packages: "external",
    external: [
      "zod",
      "node:*",
      "veryfront",
      "veryfront/*",
      "@opentelemetry/*",
      "path",
      ...relativeImports,
    ],
    stdin: {
      contents: source,
      loader,
      resolveDir: fileDir,
      // Must be a basename: esbuild joins resolveDir + sourcefile to form the
      // entry module path when sourcefile is relative. Passing the full
      // relative filePath (e.g. "tools/foo.ts") on VFS runs (baseDir === "")
      // doubles the prefix to "tools/tools/foo.ts", which anchors ../ imports
      // one directory too deep.
      sourcefile: pathHelper.basename(filePath),
    },
  });

  if (result.errors.length > 0) {
    throw COMPILATION_ERROR.create({
      detail: `Failed to transpile ${filePath}: ${result.errors[0]?.text ?? "unknown error"}`,
    });
  }

  const js = result.outputFiles?.[0]?.text ?? "export {}";

  const localFs = createFileSystem();
  const tempDir = await localFs.makeTempDir({ prefix: "vf-discovery-" });
  const tempFile = pathHelper.join(tempDir, "module.mjs");

  const transformedCode = isDeno
    ? rewriteForDeno(js, fileDir)
    : await rewriteDiscoveryImports(js, context.baseDir ?? ".", localFs, fileDir);

  await localFs.writeTextFile(tempFile, transformedCode);

  try {
    const moduleUrl = pathHelper.toFileUrl(tempFile);
    moduleUrl.searchParams.set("v", String(Date.now()));
    const module = await import(moduleUrl.href);
    transpileCache.set(file, module);
    return module;
  } finally {
    await localFs.remove(tempDir, { recursive: true });
  }
}

/**
 * Clear the transpile cache
 */
export function clearTranspileCache(): void {
  transpileCache.clear();
}

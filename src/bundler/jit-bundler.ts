/**
 * JIT (Just-In-Time) Bundler for Production Mode
 *
 * Bundles entire projects on first request using esbuild with distributed caching.
 */

import { logger } from "#veryfront/utils";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import type { Span } from "@opentelemetry/api";
import { getEsbuild } from "#veryfront/platform/compat/esbuild.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { joinPath } from "#veryfront/utils/path-utils.ts";
import {
  type BundleConfig,
  createBareImportPlugin,
  createJitBuildOptions,
  createMdxPlugin,
  createVirtualFsPlugin,
} from "./build-config.ts";
import { REACT_DEFAULT_VERSION } from "#veryfront/utils/constants/cdn.ts";
import { computeProjectContentHash, getBundleCache } from "./bundle-cache.ts";
import { getFrameworkRootFromMeta } from "#veryfront/platform/compat/vfs-paths.ts";
import {
  isExtendedFSAdapter,
  isVirtualFilesystem,
} from "#veryfront/platform/adapters/fs/wrapper.ts";

const FRAMEWORK_ROOT = getFrameworkRootFromMeta(import.meta.url);
let cachedVeryfrontFilePaths: Record<string, string> | null = null;

/**
 * Get veryfront framework file paths from deno.json imports.
 */
function getVeryfrontFilePaths(): Record<string, string> {
  if (cachedVeryfrontFilePaths) {
    return cachedVeryfrontFilePaths;
  }

  const result: Record<string, string> = {};

  try {
    // Read deno.json from framework root
    const denoJsonPath = joinPath(FRAMEWORK_ROOT, "deno.json");
    const denoJson = JSON.parse(Deno.readTextFileSync(denoJsonPath)) as {
      imports?: Record<string, string>;
    };

    const imports = denoJson.imports ?? {};

    for (const [specifier, relativePath] of Object.entries(imports)) {
      if (specifier.startsWith("veryfront/") && !specifier.startsWith("#")) {
        const absolutePath = joinPath(FRAMEWORK_ROOT, relativePath);
        result[specifier] = `file://${absolutePath}`;
      }
    }
  } catch (error) {
    logger.warn("[JitBundler] Failed to read veryfront paths from deno.json", { error });
  }

  cachedVeryfrontFilePaths = result;
  return result;
}

export interface JitBundleResult {
  code: string;
  contentHash: string;
  fromCache: boolean;
  durationMs: number;
}

export interface JitBundleOptions {
  projectId: string;
  projectDir: string;
  adapter: RuntimeAdapter;
  reactVersion?: string;
  entryPoint?: string;
  forceRebuild?: boolean;
  skipCache?: boolean;
}

/**
 * Get or build a production bundle for a project.
 */
export async function getOrBuildBundle(options: JitBundleOptions): Promise<JitBundleResult> {
  const startTime = performance.now();
  const {
    projectId,
    projectDir,
    adapter,
    reactVersion = REACT_DEFAULT_VERSION,
    entryPoint = "app.tsx",
    forceRebuild = false,
    skipCache = false,
  } = options;

  return withSpan(
    "bundler.jit.getOrBuild",
    async (span?: Span) => {
      span?.setAttributes({
        "project.id": projectId,
        "project.dir": projectDir,
        "entry.point": entryPoint,
        "force.rebuild": forceRebuild,
      });

      const projectFiles = await collectProjectFiles(projectDir, adapter);
      span?.setAttribute("project.files.count", projectFiles.size);

      const contentHash = await computeProjectContentHash(projectFiles);
      span?.setAttribute("content.hash", contentHash);

      if (!forceRebuild && !skipCache) {
        const cached = await getBundleCache().get(projectId, contentHash);
        if (cached) {
          logger.debug("[JitBundler] Cache hit", { projectId, contentHash });
          span?.setAttribute("cache.hit", true);

          return {
            code: cached.code,
            contentHash,
            fromCache: true,
            durationMs: performance.now() - startTime,
          };
        }
      }

      span?.setAttribute("cache.hit", false);

      const bundleResult = await buildProjectBundle({
        projectId,
        projectDir,
        adapter,
        reactVersion,
        entryPoint,
        projectFiles,
      });

      if (!skipCache) {
        await getBundleCache().set(projectId, contentHash, {
          code: bundleResult.code,
          contentHash,
          metafile: bundleResult.metafile,
        });
      }

      return {
        code: bundleResult.code,
        contentHash,
        fromCache: false,
        durationMs: performance.now() - startTime,
      };
    },
    { "bundler.type": "jit" },
  );
}

interface BuildResult {
  code: string;
  metafile?: Record<string, unknown>;
}

function findAllPages(projectFiles: Map<string, string>): string[] {
  const pages: string[] = [];
  const pagePatterns = /\/(page|index)\.(tsx?|jsx?|mdx?)$/;

  for (const filePath of projectFiles.keys()) {
    // Match page files in app/ or pages/ directories
    if (
      (filePath.includes("/app/") || filePath.includes("/pages/")) &&
      pagePatterns.test(filePath)
    ) {
      pages.push(filePath);
    }
  }

  return pages;
}

function findAllLayouts(projectFiles: Map<string, string>): string[] {
  const layouts: string[] = [];
  const layoutPattern = /\/layout\.(tsx?|jsx?|mdx?)$/;
  const namedLayoutPattern = /[Ll]ayout\.(tsx?|jsx?|mdx?)$/;

  for (const filePath of projectFiles.keys()) {
    const isAppLayout = filePath.includes("/app/") && layoutPattern.test(filePath);
    const isComponentLayout = filePath.includes("/components/") && namedLayoutPattern.test(filePath);
    const isLayoutDir = filePath.includes("/layouts/") && namedLayoutPattern.test(filePath);

    if (isAppLayout || isComponentLayout || isLayoutDir) {
      layouts.push(filePath);
    }
  }

  return layouts;
}

/**
 * Find the App wrapper component (components/app.tsx or similar).
 * This component typically contains providers like QueryClientProvider.
 */
function findAppComponent(projectFiles: Map<string, string>): string | null {
  const appPattern = /^components\/app\.(tsx?|jsx?)$/;

  for (const filePath of projectFiles.keys()) {
    if (appPattern.test(filePath)) {
      return filePath;
    }
  }

  return null;
}

function pathToVarName(filePath: string, prefix: string): string {
  let hash = 0;
  for (let i = 0; i < filePath.length; i++) {
    const char = filePath.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `${prefix}_${Math.abs(hash).toString(36)}`;
}

async function buildProjectBundle(options: {
  projectId: string;
  projectDir: string;
  adapter: RuntimeAdapter;
  reactVersion: string;
  entryPoint: string;
  projectFiles: Map<string, string>;
}): Promise<BuildResult> {
  const { projectId, projectDir, adapter, reactVersion, entryPoint, projectFiles } = options;

  return withSpan(
    "bundler.jit.build",
    async (span?: Span) => {
      const esbuild = await getEsbuild();
      const entryPath = joinPath(projectDir, entryPoint);

      const allPages = findAllPages(projectFiles);
      const allLayouts = findAllLayouts(projectFiles);
      const appComponent = findAppComponent(projectFiles);

      span?.setAttributes({
        "entry.path": entryPath,
        "react.version": reactVersion,
        "app.component": appComponent || "none",
        "pages.count": allPages.length,
        "layouts.count": allLayouts.length,
      });

      // Generate imports for all pages
      // Use ./ prefix to ensure these are treated as relative imports, not bare specifiers
      const pageImports: string[] = [];
      const pageExports: string[] = [];
      for (const pagePath of allPages) {
        const varName = pathToVarName(pagePath, "page");
        pageImports.push(`import ${varName} from "./${pagePath}";`);
        pageExports.push(`  "${pagePath}": ${varName},`);
      }

      // Generate imports for all layouts
      const layoutImports: string[] = [];
      const layoutExports: string[] = [];
      for (const layoutPath of allLayouts) {
        const varName = pathToVarName(layoutPath, "layout");
        layoutImports.push(`import ${varName} from "./${layoutPath}";`);
        layoutExports.push(`  "${layoutPath}": ${varName},`);
      }

      // Generate import for App component (providers wrapper)
      // Use ./ prefix to ensure it's treated as a relative import, not a bare specifier
      const appImport = appComponent ? `import __AppComponent from "./${appComponent}";` : "";
      const appExport = appComponent ? "export { __AppComponent };" : "export const __AppComponent = null;";

      const virtualEntryPath = `${projectDir}/__jit_entry__.tsx`;
      const virtualEntryCode = `
import { renderToString, renderToReadableStream } from "react-dom/server";
import * as React from "react";
import Page from "${entryPath}";
${pageImports.join("\n")}
${layoutImports.join("\n")}
${appImport}

export default Page;
export * from "${entryPath}";
export { React, renderToString, renderToReadableStream };
${appExport}
export const __pages = {
${pageExports.join("\n")}
};
export const __layouts = {
${layoutExports.join("\n")}
};
`;

      projectFiles.set(virtualEntryPath, virtualEntryCode);

      const buildConfig: BundleConfig = {
        projectId,
        projectDir,
        adapter,
        reactVersion,
        dev: false,
        target: "ssr",
        entryPoints: [virtualEntryPath],
      };

      const buildOptions = createJitBuildOptions(buildConfig);

      buildOptions.plugins = [
        createMdxPlugin(projectDir, adapter, "ssr", projectFiles),
        createVirtualFsPlugin(projectDir, adapter, projectFiles),
        createBareImportPlugin({
          reactVersion,
          veryfrontFilePaths: getVeryfrontFilePaths(),
          // Keep packages external - bundling is too slow (fetches all deps from esm.sh).
          // The "two Reacts" fix must rely on URL alignment instead.
          externalizeBareImports: true,
        }),
      ];

      const result = await esbuild.build(buildOptions);

      if (result.errors.length > 0) {
        const errorMessages = result.errors.map((e) => e.text).join("\n");
        throw new Error(`Bundle build failed: ${errorMessages}`);
      }

      const output = result.outputFiles?.[0];
      if (!output) {
        throw new Error("Bundle build produced no output");
      }

      const code = new TextDecoder().decode(output.contents);
      span?.setAttribute("bundle.size", code.length);

      return {
        code,
        metafile: result.metafile as unknown as Record<string, unknown>,
      };
    },
    { "bundler.operation": "build" },
  );
}

async function collectProjectFiles(
  projectDir: string,
  adapter: RuntimeAdapter,
): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const extensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".json", ".mdx", ".md"]);
  const excludeDirs = new Set(["node_modules", ".git", "dist", "build", ".cache", ".veryfront"]);

  const isVirtual = isVirtualFilesystem(adapter.fs);
  const isExtended = isExtendedFSAdapter(adapter.fs);

  if (isVirtual && isExtended) {
    const extendedFs = adapter.fs as import("#veryfront/platform/adapters/fs/wrapper.ts").ExtendedFileSystemAdapter;
    const underlyingAdapter = extendedFs.getUnderlyingAdapter();

    // deno-lint-ignore no-explicit-any
    const adapterWithMethod = underlyingAdapter as any;
    if (adapterWithMethod && typeof adapterWithMethod.getAllSourceFiles === "function") {

      const sourceFiles: Array<{ path: string; content?: string }> =
        await adapterWithMethod.getAllSourceFiles();

      for (const file of sourceFiles) {
        const ext = file.path.substring(file.path.lastIndexOf("."));
        if (extensions.has(ext)) {
          if (file.content !== undefined) {
            files.set(file.path, file.content);
          } else {
            try {
              const content = await adapter.fs.readFile(file.path);
              files.set(file.path, content);
            } catch {
              // Skip files that can't be read
            }
          }
        }
      }

      return files;
    }
  }

  async function walkDir(dir: string): Promise<void> {
    try {
      for await (const entry of adapter.fs.readDir(dir)) {
        const fullPath = joinPath(dir, entry.name);

        if (entry.isDirectory) {
          if (!excludeDirs.has(entry.name)) {
            await walkDir(fullPath);
          }
        } else if (entry.isFile) {
          const ext = entry.name.substring(entry.name.lastIndexOf("."));
          if (extensions.has(ext)) {
            try {
              const content = await adapter.fs.readFile(fullPath);
              // Store relative path (strip projectDir prefix) for consistent bundle keys
              const relativePath = fullPath.startsWith(projectDir)
                ? fullPath.slice(projectDir.length).replace(/^\//, "")
                : fullPath;
              files.set(relativePath, content);
            } catch {
              // Skip files that can't be read
            }
          }
        }
      }
    } catch {
      // Directory doesn't exist or can't be read
    }
  }

  await walkDir(projectDir);

  return files;
}

export async function hasCachedBundle(
  projectId: string,
  projectDir: string,
  adapter: RuntimeAdapter,
): Promise<boolean> {
  const projectFiles = await collectProjectFiles(projectDir, adapter);
  const contentHash = await computeProjectContentHash(projectFiles);
  const cached = await getBundleCache().get(projectId, contentHash);
  return cached !== null;
}

export async function invalidateProjectBundles(projectId: string): Promise<void> {
  await getBundleCache().invalidateProject(projectId);
}

export async function buildBundleFromFiles(
  projectId: string,
  files: Map<string, string>,
  entryPoint: string,
  options: {
    reactVersion?: string;
    target?: "ssr" | "browser";
  } = {},
): Promise<string> {
  const { reactVersion = REACT_DEFAULT_VERSION, target = "ssr" } = options;

  const esbuild = await getEsbuild();

  // Create a minimal adapter that reads from the files map
  const virtualAdapter = createVirtualAdapter(files);

  const buildConfig: BundleConfig = {
    projectId,
    projectDir: "/virtual",
    adapter: virtualAdapter,
    reactVersion,
    dev: false,
    target,
    entryPoints: [entryPoint],
  };

  const buildOptions = createJitBuildOptions(buildConfig);
  buildOptions.plugins = [
    createVirtualFsPlugin("/virtual", virtualAdapter, files),
    createBareImportPlugin({ reactVersion, externalizeReact: true }),
  ];

  const result = await esbuild.build(buildOptions);

  if (result.errors.length > 0) {
    throw new Error(`Build failed: ${result.errors.map((e) => e.text).join("\n")}`);
  }

  return new TextDecoder().decode(result.outputFiles?.[0]?.contents ?? new Uint8Array());
}

export async function transformModule(
  code: string,
  filePath: string,
  options: { projectDir: string; reactVersion?: string; ssr?: boolean } = { projectDir: "/" },
): Promise<string> {
  const { ssr = true } = options;
  const esbuild = await getEsbuild();

  const ext = filePath.substring(filePath.lastIndexOf("."));
  let loader: "tsx" | "ts" | "json" | "js" = "js";
  if (ext === ".tsx" || ext === ".jsx") loader = "tsx";
  else if (ext === ".ts") loader = "ts";
  else if (ext === ".json") loader = "json";

  const result = await esbuild.transform(code, {
    loader,
    format: "esm",
    target: "es2022",
    platform: ssr ? "node" : "browser",
    jsx: "automatic",
    jsxImportSource: "react",
    sourcemap: false,
    minify: false,
    treeShaking: true,
  });

  return result.code;
}

function createVirtualAdapter(files: Map<string, string>): RuntimeAdapter {
  return {
    id: "memory",
    name: "Virtual Memory Adapter",
    capabilities: {
      typescript: true,
      jsx: true,
      http2: false,
      websocket: false,
      workers: false,
      fileWatching: false,
      shell: false,
      kvStore: false,
      writableFs: false,
    },
    fs: {
      async readFile(path: string): Promise<string> {
        const content = files.get(path);
        if (content === undefined) {
          throw new Error(`File not found: ${path}`);
        }
        return content;
      },
      async writeFile(): Promise<void> {
        throw new Error("Virtual adapter does not support writes");
      },
      async exists(path: string): Promise<boolean> {
        return files.has(path);
      },
      async *readDir(): AsyncIterable<
        { name: string; isFile: boolean; isDirectory: boolean; isSymlink: boolean }
      > {
        // Not implemented for virtual adapter
      },
      async stat(
        path: string,
      ): Promise<
        {
          size: number;
          isFile: boolean;
          isDirectory: boolean;
          isSymlink: boolean;
          mtime: Date | null;
        }
      > {
        if (files.has(path)) {
          return {
            size: files.get(path)!.length,
            isFile: true,
            isDirectory: false,
            isSymlink: false,
            mtime: new Date(),
          };
        }
        throw new Error(`File not found: ${path}`);
      },
      async mkdir(): Promise<void> {
        throw new Error("Virtual adapter does not support mkdir");
      },
      async remove(): Promise<void> {
        throw new Error("Virtual adapter does not support remove");
      },
      async makeTempDir(): Promise<string> {
        throw new Error("Virtual adapter does not support makeTempDir");
      },
      watch(): never {
        throw new Error("Virtual adapter does not support watch");
      },
    },
    env: {
      get(): string | undefined {
        return undefined;
      },
      set(): void {},
      toObject(): Record<string, string> {
        return {};
      },
    },
    server: {
      upgradeWebSocket(): never {
        throw new Error("Virtual adapter does not support WebSocket");
      },
    },
    async serve(): Promise<never> {
      throw new Error("Virtual adapter does not support serve");
    },
  };
}

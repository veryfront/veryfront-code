/**
 * JIT (Just-In-Time) Bundler for Production Mode
 *
 * Bundles entire projects on first request using esbuild. The bundle is then
 * stored in the veryfront-api cache for subsequent requests. This approach:
 *
 * 1. Eliminates path tokenization issues (paths resolved at bundle time)
 * 2. Ensures every pod serves identical content (same bundle from cache)
 * 3. Provides automatic cache invalidation (content hash = cache key)
 *
 * Performance characteristics:
 * - First request: ~100-200ms to bundle
 * - Subsequent requests: ~5-10ms cache lookup
 *
 * @module bundler/jit-bundler
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
import { computeProjectContentHash, getBundleCache } from "./bundle-cache.ts";

export interface JitBundleResult {
  /** Bundled code ready for execution */
  code: string;
  /** Content hash used for caching */
  contentHash: string;
  /** Whether the bundle was served from cache */
  fromCache: boolean;
  /** Bundle creation/retrieval time in milliseconds */
  durationMs: number;
}

export interface JitBundleOptions {
  /** Project identifier */
  projectId: string;
  /** Project root directory */
  projectDir: string;
  /** Runtime adapter for filesystem access */
  adapter: RuntimeAdapter;
  /** React version */
  reactVersion?: string;
  /** Entry point file (relative to projectDir) */
  entryPoint?: string;
  /** Force rebuild even if cached */
  forceRebuild?: boolean;
  /** Skip cache storage (for testing) */
  skipCache?: boolean;
}

/**
 * Get or build a production bundle for a project.
 *
 * This is the main entry point for JIT bundling. It:
 * 1. Collects all project files
 * 2. Computes a content hash
 * 3. Checks cache for existing bundle
 * 4. If cache miss, builds bundle with esbuild
 * 5. Stores bundle in cache for future requests
 */
export async function getOrBuildBundle(options: JitBundleOptions): Promise<JitBundleResult> {
  const startTime = performance.now();
  const {
    projectId,
    projectDir,
    adapter,
    reactVersion = "18.3.1",
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

      // Step 1: Collect project files
      const projectFiles = await collectProjectFiles(projectDir, adapter);
      span?.setAttribute("project.files.count", projectFiles.size);

      // Step 2: Compute content hash
      const contentHash = await computeProjectContentHash(projectFiles);
      span?.setAttribute("content.hash", contentHash);

      // Step 3: Check cache (unless forced rebuild)
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
      logger.debug("[JitBundler] Cache miss, building bundle", { projectId, contentHash });

      // Step 4: Build bundle
      const bundleResult = await buildProjectBundle({
        projectId,
        projectDir,
        adapter,
        reactVersion,
        entryPoint,
        projectFiles,
      });

      // Step 5: Store in cache
      if (!skipCache) {
        await getBundleCache().set(projectId, contentHash, {
          code: bundleResult.code,
          contentHash,
          metafile: bundleResult.metafile,
        });
        logger.debug("[JitBundler] Bundle cached", { projectId, contentHash });
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

      span?.setAttributes({
        "entry.path": entryPath,
        "react.version": reactVersion,
      });

      // Create build configuration
      const buildConfig: BundleConfig = {
        projectId,
        projectDir,
        adapter,
        reactVersion,
        dev: false,
        target: "ssr",
        entryPoints: [entryPath],
      };

      // Get optimized build options for JIT bundling
      const buildOptions = createJitBuildOptions(buildConfig);

      // Add virtual filesystem plugin with project files and MDX support
      buildOptions.plugins = [
        createVirtualFsPlugin(projectDir, adapter, projectFiles),
        createMdxPlugin(projectDir, adapter, "ssr"), // Full MDX compilation support
        createBareImportPlugin(reactVersion, true),
      ];

      // Build with esbuild
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

/**
 * Collect all relevant project files for bundling.
 *
 * This includes:
 * - TypeScript/JavaScript files (.ts, .tsx, .js, .jsx)
 * - MDX/Markdown files (.mdx, .md)
 * - JSON files (.json)
 *
 * Excludes:
 * - node_modules
 * - .git
 * - dist/build directories
 */
async function collectProjectFiles(
  projectDir: string,
  adapter: RuntimeAdapter,
): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const extensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".json", ".mdx", ".md"]);
  const excludeDirs = new Set(["node_modules", ".git", "dist", "build", ".cache", ".veryfront"]);

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
              files.set(fullPath, content);
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

/**
 * Check if a cached bundle exists for a project
 */
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

/**
 * Invalidate all cached bundles for a project
 */
export async function invalidateProjectBundles(projectId: string): Promise<void> {
  await getBundleCache().invalidateProject(projectId);
  logger.debug("[JitBundler] Invalidated all bundles", { projectId });
}

/**
 * Build a bundle from explicit project files (for testing/special cases)
 */
export async function buildBundleFromFiles(
  projectId: string,
  files: Map<string, string>,
  entryPoint: string,
  options: {
    reactVersion?: string;
    target?: "ssr" | "browser";
  } = {},
): Promise<string> {
  const { reactVersion = "18.3.1", target = "ssr" } = options;

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
    createBareImportPlugin(reactVersion, true),
  ];

  const result = await esbuild.build(buildOptions);

  if (result.errors.length > 0) {
    throw new Error(`Build failed: ${result.errors.map((e) => e.text).join("\n")}`);
  }

  return new TextDecoder().decode(result.outputFiles?.[0]?.contents ?? new Uint8Array());
}

/**
 * Transform a single module using esbuild.
 * Used for data fetching modules that need to be imported dynamically.
 */
export async function transformModule(
  code: string,
  filePath: string,
  options: {
    projectDir: string;
    reactVersion?: string;
    ssr?: boolean;
  } = { projectDir: "/" },
): Promise<string> {
  const { projectDir: _projectDir, reactVersion: _reactVersion = "18.3.1", ssr = true } = options;
  const esbuild = await getEsbuild();

  // Determine loader from file extension
  const ext = filePath.substring(filePath.lastIndexOf("."));
  const loader = ext === ".tsx" || ext === ".jsx"
    ? "tsx"
    : ext === ".ts"
    ? "ts"
    : ext === ".json"
    ? "json"
    : "js";

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

  if (result.warnings.length > 0) {
    logger.debug("[JitBundler] Transform warnings", {
      filePath,
      warnings: result.warnings.map((w) => w.text),
    });
  }

  return result.code;
}

/**
 * Create a virtual adapter for building from a file map
 */
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

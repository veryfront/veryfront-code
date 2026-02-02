/**
 * Shared esbuild configuration for production JIT bundling and preview watch mode.
 *
 * This module provides a unified build configuration that can be used by both:
 * - JIT Bundler: Full project bundling on first production request
 * - Preview Bundler: Watch mode with incremental rebuilds and HMR
 *
 * @module bundler/build-config
 */

import type { BuildOptions, Plugin } from "esbuild";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { getDirectory, joinPath } from "#veryfront/utils/path-utils.ts";
import {
  getReactCDNUrl,
  getReactDOMCDNUrl,
  getReactDOMClientCDNUrl,
  getReactDOMServerCDNUrl,
  getReactJSXDevRuntimeCDNUrl,
  getReactJSXRuntimeCDNUrl,
  REACT_DEFAULT_VERSION,
} from "#veryfront/utils/constants/cdn.ts";

export interface BundleConfig {
  /** Project identifier for cache isolation */
  projectId: string;
  /** Root directory of the project */
  projectDir: string;
  /** Runtime adapter for filesystem access */
  adapter: RuntimeAdapter;
  /** React version to use */
  reactVersion?: string;
  /** Development mode (affects minification, sourcemaps) */
  dev?: boolean;
  /** Target: SSR or browser */
  target: "ssr" | "browser";
  /** Entry point file paths */
  entryPoints: string[];
  /** External packages (not bundled) */
  external?: string[];
  /**
   * Pre-cached React file:// paths for SSR.
   * When provided, React imports resolve to these paths instead of CDN URLs.
   * This ensures JIT bundled code uses the same React instance as SSR.
   */
  reactFilePaths?: Record<string, string>;
}

export interface SharedBuildConfig {
  format: "esm";
  platform: "browser" | "node" | "neutral";
  target: string;
  bundle: boolean;
  write: boolean;
  minify: boolean;
  sourcemap: boolean | "inline" | "external";
  treeShaking: boolean;
  jsx: "automatic";
  jsxImportSource: string;
  external: string[];
  plugins: Plugin[];
  metafile: boolean;
}

/**
 * Get React CDN URLs for a given version
 */
export function getReactExternals(_reactVersion: string = REACT_DEFAULT_VERSION): string[] {
  return [
    "react",
    "react-dom",
    "react-dom/client",
    "react-dom/server",
    "react/jsx-runtime",
    "react/jsx-dev-runtime",
  ];
}

/**
 * Get React CDN URL mapping for browser imports
 */
export function getReactCDNMapping(
  reactVersion: string = REACT_DEFAULT_VERSION,
): Record<string, string> {
  return {
    react: getReactCDNUrl(reactVersion),
    "react-dom": getReactDOMCDNUrl(reactVersion),
    "react-dom/client": getReactDOMClientCDNUrl(reactVersion),
    "react-dom/server": getReactDOMServerCDNUrl(reactVersion),
    "react/jsx-runtime": getReactJSXRuntimeCDNUrl(reactVersion),
    "react/jsx-dev-runtime": getReactJSXDevRuntimeCDNUrl(reactVersion),
  };
}

type EsbuildLoader = "tsx" | "ts" | "jsx" | "js" | "css" | "json";

/**
 * Get the appropriate esbuild loader for a file path
 */
export function getLoaderForPath(path: string): EsbuildLoader {
  if (path.endsWith(".tsx")) return "tsx";
  if (path.endsWith(".ts")) return "ts";
  if (path.endsWith(".jsx")) return "jsx";
  if (path.endsWith(".css")) return "css";
  if (path.endsWith(".json")) return "json";
  return "js";
}

/**
 * Create a virtual filesystem plugin for esbuild.
 *
 * This plugin allows esbuild to resolve and load files through the RuntimeAdapter,
 * which supports both local filesystem and remote API-backed filesystems.
 */
export function createVirtualFsPlugin(
  projectDir: string,
  adapter: RuntimeAdapter,
  virtualFiles?: Map<string, string>,
): Plugin {
  const exts = [".tsx", ".ts", ".jsx", ".js", ".mjs", ".json", ".mdx", ".md"];

  return {
    name: "veryfront-virtual-fs",
    setup(build) {
      // Handle virtual files
      if (virtualFiles?.size) {
        // Resolve handler for virtual files (skip MDX - handled by MDX plugin)
        build.onResolve({ filter: /.*/ }, (args) => {
          // Skip MDX files - they should be handled by createMdxPlugin
          if (args.path.endsWith(".mdx") || args.path.endsWith(".md")) {
            return undefined;
          }

          // For entry points and absolute paths
          if (args.path.startsWith("/")) {
            if (virtualFiles.has(args.path)) {
              return {
                path: args.path,
                namespace: "virtual",
              };
            }
            return undefined;
          }

          // For relative imports from virtual files
          if (args.path.startsWith(".") && args.namespace === "virtual") {
            // resolveDir is set by onLoad, use it directly
            const baseDir = args.resolveDir || projectDir;
            const resolved = joinPath(baseDir, args.path);

            // Try exact path first
            if (virtualFiles.has(resolved)) {
              return {
                path: resolved,
                namespace: "virtual",
              };
            }

            // Try with extensions
            for (const ext of exts) {
              const withExt = resolved + ext;
              if (virtualFiles.has(withExt)) {
                return {
                  path: withExt,
                  namespace: "virtual",
                };
              }
            }

            // Try index files
            for (const ext of exts) {
              const indexPath = joinPath(resolved, `index${ext}`);
              if (virtualFiles.has(indexPath)) {
                return {
                  path: indexPath,
                  namespace: "virtual",
                };
              }
            }
          }

          return undefined;
        });

        // Load handler for virtual files (skip MDX - handled by MDX plugin)
        build.onLoad({ filter: /.*/, namespace: "virtual" }, (args) => {
          // Skip MDX files - they should be handled by createMdxPlugin
          if (args.path.endsWith(".mdx") || args.path.endsWith(".md")) {
            return undefined;
          }

          const contents = virtualFiles.get(args.path);
          if (contents !== undefined) {
            return {
              contents,
              loader: getLoaderForPath(args.path),
              // Set resolveDir so relative imports work
              resolveDir: getDirectory(args.path),
            };
          }
          return undefined;
        });
      }

      // Resolve relative and absolute imports through adapter
      // Skip MDX files - they are handled by createMdxPlugin
      build.onResolve({ filter: /^(\.?\.?\/|\/)\/*/ }, async (args) => {
        // Skip MDX files - let MDX plugin handle them
        if (args.path.endsWith(".mdx") || args.path.endsWith(".md")) {
          return undefined;
        }

        const basedir = args.resolveDir ||
          (args.importer ? getDirectory(args.importer) : projectDir);
        const candidate = args.path.startsWith("/")
          ? joinPath(projectDir, args.path)
          : joinPath(basedir, args.path);

        const candidates: string[] = [candidate];
        for (const ext of exts) candidates.push(candidate + ext);
        for (const ext of exts) candidates.push(joinPath(candidate, `index${ext}`));

        for (const f of candidates) {
          try {
            const st = await adapter.fs.stat(f);
            if (st.isFile) return { path: f };
          } catch {
            // Try next candidate
          }
        }

        return undefined;
      });

      // Load files through adapter
      build.onLoad({ filter: /\.(tsx?|jsx?|mjs)$/ }, async (args) => {
        // Skip virtual namespace (handled above) and https namespace (handled by bare-import plugin)
        if (args.namespace === "virtual" || args.namespace === "https") return undefined;

        try {
          const contents = await adapter.fs.readFile(args.path);
          return { contents, loader: getLoaderForPath(args.path) };
        } catch (error) {
          return {
            errors: [
              {
                text: `Failed to read ${args.path}: ${String(error)}`,
                location: null,
              },
            ],
          };
        }
      });
    },
  };
}

/**
 * Options for the bare import plugin
 */
export interface BareImportPluginOptions {
  /** React version for CDN mapping */
  reactVersion?: string;
  /** Whether to mark React as external (default: true) */
  externalizeReact?: boolean;
  /** Whether to mark non-React bare imports as external (default: true) */
  externalizeBareImports?: boolean;
  /** Pre-cached React file:// paths to use instead of CDN URLs */
  reactFilePaths?: Record<string, string>;
}

/**
 * Create a plugin that resolves bare imports to esm.sh URLs
 *
 * When reactFilePaths is provided, React imports are resolved to those file://
 * paths instead of CDN URLs. This enables sharing the same React instance
 * between JIT bundled code and SSR execution.
 */
export function createBareImportPlugin(
  reactVersionOrOptions: string | BareImportPluginOptions = REACT_DEFAULT_VERSION,
  externalizeReact: boolean = true,
): Plugin {
  // Support both old signature (string, boolean) and new options object
  const options: BareImportPluginOptions = typeof reactVersionOrOptions === "string"
    ? { reactVersion: reactVersionOrOptions, externalizeReact }
    : reactVersionOrOptions;

  const reactVersion = options.reactVersion ?? REACT_DEFAULT_VERSION;
  const shouldExternalize = options.externalizeReact ?? true;
  const shouldExternalizeBare = options.externalizeBareImports ?? true;
  const reactFilePaths = options.reactFilePaths;

  // Use file:// paths if provided, otherwise fall back to CDN mapping
  const reactMapping = reactFilePaths ?? getReactCDNMapping(reactVersion);

  return {
    name: "veryfront-bare-imports",
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        // Skip relative, absolute, and URL imports
        if (
          args.path.startsWith(".") ||
          args.path.startsWith("/") ||
          args.path.startsWith("http://") ||
          args.path.startsWith("https://") ||
          args.path.startsWith("file://")
        ) {
          return undefined;
        }

        // Only handle import statements
        if (args.kind !== "import-statement" && args.kind !== "dynamic-import") {
          return undefined;
        }

        // Map React packages
        const resolvedPath = reactMapping[args.path];
        if (resolvedPath) {
          // File paths are always external (already cached locally)
          if (resolvedPath.startsWith("file://")) {
            return { path: resolvedPath, external: true };
          }

          // CDN URLs: externalize or load from HTTPS
          if (shouldExternalize) {
            return { path: resolvedPath, external: true };
          }
          return { path: resolvedPath, namespace: "https" };
        }

        // Map other bare imports to esm.sh with external React to prevent duplicate React copies
        const url = `https://esm.sh/${args.path}?external=react,react-dom&target=es2022`;
        if (shouldExternalizeBare) {
          return { path: url, external: true };
        }
        return { path: url, namespace: "https" };
      });

      const shouldLoadHttps = !shouldExternalize || !shouldExternalizeBare;
      // If bundling any HTTPS modules, load from HTTPS and handle nested imports
      if (shouldLoadHttps) {
        // Resolve imports within HTTPS modules (e.g., esm.sh internal paths)
        build.onResolve({ filter: /^\//, namespace: "https" }, (args) => {
          // Resolve absolute paths relative to the esm.sh base URL
          try {
            const baseUrl = new URL(args.importer).origin;
            const resolvedUrl = `${baseUrl}${args.path}`;
            return { path: resolvedUrl, namespace: "https" };
          } catch {
            // If importer URL parsing fails, fall back to esm.sh origin
            const resolvedUrl = `https://esm.sh${args.path}`;
            return { path: resolvedUrl, namespace: "https" };
          }
        });

        // Also handle relative paths in HTTPS modules
        build.onResolve({ filter: /^\./, namespace: "https" }, (args) => {
          try {
            const base = new URL(args.importer);
            const resolved = new URL(args.path, base).href;
            return { path: resolved, namespace: "https" };
          } catch {
            return undefined;
          }
        });

        build.onLoad({ filter: /.*/, namespace: "https" }, async (args) => {
          try {
            const response = await fetch(args.path, { redirect: "follow" });
            if (!response.ok) {
              throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            const contents = await response.text();
            return { contents, loader: "js" };
          } catch (error) {
            return {
              errors: [
                {
                  text: `Failed to fetch ${args.path}: ${String(error)}`,
                  location: null,
                },
              ],
            };
          }
        });
      }
    },
  };
}

/**
 * Create a plugin that compiles MDX files to JavaScript.
 *
 * This preserves all MDX capabilities from the legacy renderer:
 * - Frontmatter extraction
 * - Remark/Rehype plugins
 * - Import rewriting
 * - JSX compilation
 */
export function createMdxPlugin(
  projectDir: string,
  adapter: RuntimeAdapter,
  target: "ssr" | "browser" = "ssr",
  virtualFiles?: Map<string, string>,
): Plugin {
  return {
    name: "veryfront-mdx",
    setup(build) {
      // Resolve MDX file imports
      build.onResolve({ filter: /\.mdx?$/ }, (args) => {
        if (args.path.startsWith("/")) {
          // Check if this is a virtual file
          if (virtualFiles?.has(args.path)) {
            return { path: args.path, namespace: "mdx-virtual" };
          }
          return { path: args.path };
        }

        // For relative imports, use resolveDir from esbuild (set by onLoad handlers)
        // This avoids issues with namespace prefixes in args.importer
        const basedir = args.resolveDir ||
          (args.importer ? getDirectory(args.importer) : projectDir);
        const resolved = joinPath(basedir, args.path);

        // Check if resolved path is a virtual file
        if (virtualFiles?.has(resolved)) {
          return { path: resolved, namespace: "mdx-virtual" };
        }
        return { path: resolved };
      });

      // Compile MDX files from virtual filesystem
      build.onLoad({ filter: /\.mdx?$/, namespace: "mdx-virtual" }, async (args) => {
        try {
          const content = virtualFiles?.get(args.path);
          if (!content) {
            return {
              errors: [{ text: `Virtual MDX file not found: ${args.path}`, location: null }],
            };
          }

          const { compileMDXRuntime } = await import(
            "#veryfront/transforms/mdx/compiler/mdx-compiler.ts"
          );

          const compilationTarget = target === "ssr" ? "server" : "browser";
          const result = await compileMDXRuntime(
            "production",
            projectDir,
            content,
            undefined,
            args.path,
            compilationTarget,
            undefined,
          );

          return {
            contents: result.compiledCode,
            loader: "jsx",
            resolveDir: getDirectory(args.path),
          };
        } catch (error) {
          return {
            errors: [
              {
                text: `MDX compilation failed for ${args.path}: ${String(error)}`,
                location: null,
              },
            ],
          };
        }
      });

      // Compile MDX files from real filesystem
      build.onLoad({ filter: /\.mdx?$/ }, async (args) => {
        // Skip if in a different namespace (like mdx-virtual, which is handled above)
        if (args.namespace && args.namespace !== "file") return undefined;

        try {
          // Read MDX content
          const content = await adapter.fs.readFile(args.path);

          // Dynamic import to avoid circular dependencies
          const { compileMDXRuntime } = await import(
            "#veryfront/transforms/mdx/compiler/mdx-compiler.ts"
          );

          // Compile MDX to JavaScript (preserves all MDX features)
          const compilationTarget = target === "ssr" ? "server" : "browser";
          const result = await compileMDXRuntime(
            "production",
            projectDir,
            content,
            undefined, // frontmatter (extracted from content)
            args.path,
            compilationTarget,
            undefined, // baseUrl
          );

          return {
            contents: result.compiledCode,
            loader: "jsx",
            resolveDir: getDirectory(args.path),
          };
        } catch (error) {
          return {
            errors: [
              {
                text: `MDX compilation failed for ${args.path}: ${String(error)}`,
                location: null,
              },
            ],
          };
        }
      });
    },
  };
}

/**
 * Create a plugin that injects HMR runtime code
 */
export function createHmrPlugin(projectId: string, hmrPort?: number): Plugin {
  return {
    name: "veryfront-hmr",
    setup(build) {
      build.onEnd((result) => {
        if (result.errors.length > 0) return;

        // Inject HMR runtime into output
        for (const file of result.outputFiles || []) {
          if (file.path.endsWith(".js")) {
            const hmrRuntime = createHmrRuntime(projectId, hmrPort);
            file.contents = new TextEncoder().encode(
              hmrRuntime + new TextDecoder().decode(file.contents),
            );
          }
        }
      });
    },
  };
}

/**
 * Generate HMR client runtime code
 */
export function createHmrRuntime(projectId: string, hmrPort?: number): string {
  const port = hmrPort || 3001;
  return `
// Veryfront HMR Runtime
(function() {
  if (typeof window === 'undefined') return;
  if (window.__VF_HMR_CONNECTED__) return;
  window.__VF_HMR_CONNECTED__ = true;

  const projectId = ${JSON.stringify(projectId)};
  const wsUrl = \`ws://\${location.hostname}:${port}/_vf/hmr?project=\${projectId}\`;

  let ws;
  let reconnectAttempts = 0;
  const maxReconnectAttempts = 10;

  function connect() {
    ws = new WebSocket(wsUrl);

    ws.onopen = function() {
      console.log('[HMR] Connected');
      reconnectAttempts = 0;
    };

    ws.onmessage = function(event) {
      try {
        const message = JSON.parse(event.data);
        handleHmrMessage(message);
      } catch (e) {
        console.error('[HMR] Failed to parse message:', e);
      }
    };

    ws.onclose = function() {
      if (reconnectAttempts < maxReconnectAttempts) {
        reconnectAttempts++;
        const delay = Math.min(1000 * reconnectAttempts, 5000);
        console.log('[HMR] Disconnected. Reconnecting in ' + delay + 'ms...');
        setTimeout(connect, delay);
      }
    };

    ws.onerror = function(err) {
      console.error('[HMR] WebSocket error:', err);
    };
  }

  function handleHmrMessage(message) {
    switch (message.type) {
      case 'update':
        console.log('[HMR] Update received:', message.modules?.length || 0, 'modules');
        // Try React Fast Refresh first
        if (window.__REACT_REFRESH_RUNTIME__) {
          try {
            window.__REACT_REFRESH_RUNTIME__.performReactRefresh();
            return;
          } catch (e) {
            console.warn('[HMR] React Fast Refresh failed:', e);
          }
        }
        // Fall back to full reload
        location.reload();
        break;

      case 'full-reload':
        console.log('[HMR] Full reload requested');
        location.reload();
        break;

      case 'error':
        console.error('[HMR] Build error:', message.error);
        break;

      default:
        console.log('[HMR] Unknown message type:', message.type);
    }
  }

  connect();
})();
`;
}

/**
 * Create shared esbuild build options
 */
export function createBuildOptions(config: BundleConfig): BuildOptions {
  const {
    projectDir,
    adapter,
    reactVersion = REACT_DEFAULT_VERSION,
    dev = false,
    target,
    entryPoints,
    external = [],
    reactFilePaths,
  } = config;

  // Use pre-cached file:// paths for SSR if available
  const bareImportPlugin = reactFilePaths
    ? createBareImportPlugin({ reactVersion, externalizeReact: true, reactFilePaths })
    : createBareImportPlugin(reactVersion, true);

  const plugins: Plugin[] = [
    createVirtualFsPlugin(projectDir, adapter),
    createMdxPlugin(projectDir, adapter, target), // MDX support
    bareImportPlugin,
  ];

  // Base options shared between SSR and browser targets
  const baseOptions: BuildOptions = {
    entryPoints,
    bundle: true,
    format: "esm",
    write: false,
    metafile: true,
    treeShaking: true,
    jsx: "automatic",
    jsxImportSource: "react",
    plugins,
  };

  if (target === "ssr") {
    return {
      ...baseOptions,
      platform: "node",
      target: "es2022",
      minify: !dev,
      sourcemap: dev ? "inline" : false,
      // NOTE: For JIT bundles, we do NOT externalize React because:
      // 1. Blob URL execution cannot resolve external React imports
      // 2. React needs to be bundled into the code for proper execution
      // Only externalize non-React packages
      external: external.filter((pkg) => !pkg.startsWith("react")),
      conditions: ["node", "import"],
    };
  }

  // Browser target
  return {
    ...baseOptions,
    platform: "browser",
    target: "es2020",
    minify: !dev,
    sourcemap: dev ? "inline" : false,
    external: [...getReactExternals(reactVersion), ...external],
    conditions: ["browser", "import"],
  };
}

/**
 * Create build options for production JIT bundling
 */
export function createJitBuildOptions(config: BundleConfig): BuildOptions {
  return {
    ...createBuildOptions({ ...config, dev: false }),
    minify: true,
    sourcemap: false,
    splitting: false,
    treeShaking: true,
    legalComments: "none",
  };
}

/**
 * Create build options for preview watch mode
 */
export function createPreviewBuildOptions(
  config: BundleConfig,
  hmrPort?: number,
): BuildOptions {
  const baseOptions = createBuildOptions({ ...config, dev: true });

  return {
    ...baseOptions,
    minify: false,
    sourcemap: "inline",
    plugins: [...(baseOptions.plugins || []), createHmrPlugin(config.projectId, hmrPort)],
  };
}

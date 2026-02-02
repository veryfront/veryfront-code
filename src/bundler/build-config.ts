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
  return ["react", "react-dom", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime"];
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
        // Resolve handler for virtual files
        build.onResolve({ filter: /.*/ }, (args) => {
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

        // Load handler for virtual files
        build.onLoad({ filter: /.*/, namespace: "virtual" }, (args) => {
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
      build.onResolve({ filter: /^(\.?\.?\/|\/)\/*/ }, async (args) => {
        const basedir = args.importer ? getDirectory(args.importer) : projectDir;
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
        // Skip virtual namespace (handled above)
        if (args.namespace === "virtual") return undefined;

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
 * Create a plugin that resolves bare imports to esm.sh URLs
 */
export function createBareImportPlugin(
  reactVersion: string = REACT_DEFAULT_VERSION,
  externalizeReact: boolean = true,
): Plugin {
  const reactMapping = getReactCDNMapping(reactVersion);

  return {
    name: "veryfront-bare-imports",
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        // Skip relative, absolute, and URL imports
        if (
          args.path.startsWith(".") ||
          args.path.startsWith("/") ||
          args.path.startsWith("http://") ||
          args.path.startsWith("https://")
        ) {
          return undefined;
        }

        // Only handle import statements
        if (args.kind !== "import-statement" && args.kind !== "dynamic-import") {
          return undefined;
        }

        // Map React packages to CDN
        if (reactMapping[args.path]) {
          if (externalizeReact) {
            return { path: reactMapping[args.path], external: true };
          }
          return { path: reactMapping[args.path], namespace: "https" };
        }

        // Map other bare imports to esm.sh with external React to prevent bundling
        return {
          path: `https://esm.sh/${args.path}?external=react,react-dom&target=es2022`,
          external: true,
        };
      });

      // If not externalizing React, load from HTTPS
      if (!externalizeReact) {
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
): Plugin {
  return {
    name: "veryfront-mdx",
    setup(build) {
      // Resolve MDX file imports
      build.onResolve({ filter: /\.mdx?$/ }, (args) => {
        if (args.path.startsWith("/")) {
          return { path: args.path };
        }
        const basedir = args.importer ? getDirectory(args.importer) : projectDir;
        return { path: joinPath(basedir, args.path) };
      });

      // Compile MDX files
      build.onLoad({ filter: /\.mdx?$/ }, async (args) => {
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
  } = config;

  const plugins: Plugin[] = [
    createVirtualFsPlugin(projectDir, adapter),
    createMdxPlugin(projectDir, adapter, target), // MDX support
    createBareImportPlugin(reactVersion, true),
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
      external: [...getReactExternals(reactVersion), ...external],
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

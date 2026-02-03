/**
 * Shared esbuild configuration for JIT bundling and preview watch mode.
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
  projectId: string;
  projectDir: string;
  adapter: RuntimeAdapter;
  reactVersion?: string;
  dev?: boolean;
  target: "ssr" | "browser";
  entryPoints: string[];
  external?: string[];
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
 * Resolves and loads files through the RuntimeAdapter.
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
      if (virtualFiles?.size) {
        build.onResolve({ filter: /.*/ }, (args) => {
          if (args.path.endsWith(".mdx") || args.path.endsWith(".md")) {
            return undefined;
          }

          if (args.path.startsWith("/")) {
            if (virtualFiles.has(args.path)) {
              return {
                path: args.path,
                namespace: "virtual",
              };
            }
            return undefined;
          }

          if (args.path.startsWith(".") && args.namespace === "virtual") {
            const baseDir = args.resolveDir || projectDir;
            const resolved = joinPath(baseDir, args.path);

            // Try absolute path first
            if (virtualFiles.has(resolved)) {
              return {
                path: resolved,
                namespace: "virtual",
              };
            }

            // Try relative path (projectFiles map may use relative keys)
            const relativeResolved = resolved.startsWith(projectDir + "/")
              ? resolved.slice(projectDir.length + 1)
              : resolved.startsWith(projectDir)
                ? resolved.slice(projectDir.length).replace(/^\//, "")
                : null;

            // Also try stripping ./ from original path as a direct key
            const directKey = args.path.startsWith("./") ? args.path.slice(2) : args.path;

            if (relativeResolved && virtualFiles.has(relativeResolved)) {
              return {
                path: relativeResolved,
                namespace: "virtual",
              };
            }

            // Try direct key (strip ./ prefix)
            if (virtualFiles.has(directKey)) {
              return {
                path: directKey,
                namespace: "virtual",
              };
            }

            // Try with extensions (absolute paths)
            for (const ext of exts) {
              const withExt = resolved + ext;
              if (virtualFiles.has(withExt)) {
                return {
                  path: withExt,
                  namespace: "virtual",
                };
              }
            }

            // Try with extensions (relative paths)
            if (relativeResolved) {
              for (const ext of exts) {
                const withExt = relativeResolved + ext;
                if (virtualFiles.has(withExt)) {
                  return {
                    path: withExt,
                    namespace: "virtual",
                  };
                }
              }
            }

            // Try index files (absolute paths)
            for (const ext of exts) {
              const indexPath = joinPath(resolved, `index${ext}`);
              if (virtualFiles.has(indexPath)) {
                return {
                  path: indexPath,
                  namespace: "virtual",
                };
              }
            }

            // Try index files (relative paths)
            if (relativeResolved) {
              for (const ext of exts) {
                const indexPath = joinPath(relativeResolved, `index${ext}`);
                if (virtualFiles.has(indexPath)) {
                  return {
                    path: indexPath,
                    namespace: "virtual",
                  };
                }
              }
            }
          }

          // Fallback for relative paths when namespace isn't "virtual"
          // This handles cases where the entry point wasn't resolved through our handlers
          if (args.path.startsWith(".") && args.namespace !== "virtual") {
            const directKey = args.path.startsWith("./") ? args.path.slice(2) : args.path;
            if (virtualFiles.has(directKey)) {
              return {
                path: directKey,
                namespace: "virtual",
              };
            }
          }

          return undefined;
        });

        build.onLoad({ filter: /.*/, namespace: "virtual" }, (args) => {
          if (args.path.endsWith(".mdx") || args.path.endsWith(".md")) {
            return undefined;
          }

          const contents = virtualFiles.get(args.path);
          if (contents !== undefined) {
            return {
              contents,
              loader: getLoaderForPath(args.path),
              resolveDir: getDirectory(args.path),
            };
          }
          return undefined;
        });
      }

      build.onResolve({ filter: /^@\// }, async (args) => {
        if (args.path.endsWith(".mdx") || args.path.endsWith(".md")) {
          return undefined;
        }

        const relativePath = args.path.slice(2);
        const candidate = joinPath(projectDir, relativePath);

        const candidates: string[] = [candidate];
        for (const ext of exts) candidates.push(candidate + ext);
        for (const ext of exts) candidates.push(joinPath(candidate, `index${ext}`));

        if (virtualFiles?.size) {
          for (const f of candidates) {
            if (virtualFiles.has(f)) {
              return { path: f, namespace: "virtual" };
            }
          }
        }

        for (const f of candidates) {
          try {
            const st = await adapter.fs.stat(f);
            if (st.isFile) {
              if (virtualFiles) {
                const content = await adapter.fs.readFile(f);
                virtualFiles.set(f, content);
              }
              return { path: f, namespace: "virtual" };
            }
          } catch {
            // File doesn't exist
          }
        }

        return undefined;
      });

      build.onResolve({ filter: /^(\.?\.?\/|\/)\/*/ }, async (args) => {
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

        // Also try relative paths (projectFiles map may use relative keys)
        const relativeCandidate = candidate.startsWith(projectDir + "/")
          ? candidate.slice(projectDir.length + 1)
          : candidate.startsWith(projectDir)
            ? candidate.slice(projectDir.length).replace(/^\//, "")
            : null;
        if (relativeCandidate) {
          candidates.push(relativeCandidate);
          for (const ext of exts) candidates.push(relativeCandidate + ext);
          for (const ext of exts) candidates.push(joinPath(relativeCandidate, `index${ext}`));
        }

        if (virtualFiles?.size) {
          for (const f of candidates) {
            if (virtualFiles.has(f)) {
              return { path: f, namespace: "virtual" };
            }
          }
        }

        for (const f of candidates) {
          try {
            const st = await adapter.fs.stat(f);
            if (st.isFile) {
              if (virtualFiles) {
                const content = await adapter.fs.readFile(f);
                virtualFiles.set(f, content);
              }
              return { path: f, namespace: "virtual" };
            }
          } catch {
            // File doesn't exist
          }
        }

        return undefined;
      });

      build.onLoad({ filter: /\.(tsx?|jsx?|mjs)$/ }, async (args) => {
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

export interface BareImportPluginOptions {
  reactVersion?: string;
  externalizeReact?: boolean;
  externalizeBareImports?: boolean;
  reactFilePaths?: Record<string, string>;
  veryfrontFilePaths?: Record<string, string>;
}

/**
 * Create a plugin that resolves bare imports to esm.sh URLs.
 * React imports use file:// paths if provided, otherwise CDN URLs.
 */
export function createBareImportPlugin(
  reactVersionOrOptions: string | BareImportPluginOptions = REACT_DEFAULT_VERSION,
  externalizeReact: boolean = true,
): Plugin {
  const options: BareImportPluginOptions = typeof reactVersionOrOptions === "string"
    ? { reactVersion: reactVersionOrOptions, externalizeReact }
    : reactVersionOrOptions;

  const reactVersion = options.reactVersion ?? REACT_DEFAULT_VERSION;
  const shouldExternalize = options.externalizeReact ?? true;
  const shouldExternalizeBare = options.externalizeBareImports ?? true;
  const { reactFilePaths, veryfrontFilePaths } = options;
  const reactMapping = reactFilePaths ?? getReactCDNMapping(reactVersion);

  return {
    name: "veryfront-bare-imports",
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        // Fix esm.sh URLs missing React version parameters.
        // IMPORTANT: Do NOT add external=react,react-dom - it causes bare imports that resolve to latest React.
        if (args.path.startsWith("https://esm.sh/") && !args.path.includes("deps=")) {
          const url = new URL(args.path);
          // Skip React core packages (react, react-dom) but NOT packages that start with "react-" (e.g., react-hook-form)
          const isReactCore = /^\/react(@|$|\/)/i.test(url.pathname) ||
            /^\/react-dom(@|$|\/)/i.test(url.pathname) ||
            url.pathname.startsWith("/@types/react");
          if (!isReactCore) {
            url.searchParams.set("deps", `react@${reactVersion},react-dom@${reactVersion}`);
            // Remove any existing external param that includes react
            if (url.searchParams.has("external")) {
              const existingExternal = url.searchParams.get("external") || "";
              const nonReactExternal = existingExternal
                .split(",")
                .filter((e) => e !== "react" && e !== "react-dom")
                .join(",");
              if (nonReactExternal) {
                url.searchParams.set("external", nonReactExternal);
              } else {
                url.searchParams.delete("external");
              }
            }
            if (!url.searchParams.has("target")) {
              url.searchParams.set("target", "es2022");
            }
            const fixedUrl = url.toString();
            if (shouldExternalizeBare) {
              return { path: fixedUrl, external: true };
            }
            return { path: fixedUrl, namespace: "https" };
          }
        }

        if (
          args.path.startsWith(".") ||
          args.path.startsWith("/") ||
          args.path.startsWith("http://") ||
          args.path.startsWith("https://") ||
          args.path.startsWith("file://")
        ) {
          return undefined;
        }

        if (args.kind !== "import-statement" && args.kind !== "dynamic-import") {
          return undefined;
        }

        const resolvedPath = reactMapping[args.path];
        if (resolvedPath) {
          if (resolvedPath.startsWith("file://")) {
            return { path: resolvedPath, external: true };
          }

          if (shouldExternalize) {
            return { path: resolvedPath, external: true };
          }
          return { path: resolvedPath, namespace: "https" };
        }

        if (veryfrontFilePaths) {
          const veryfrontPath = veryfrontFilePaths[args.path];
          if (veryfrontPath) {
            if (veryfrontPath.startsWith("file://")) {
              return { path: veryfrontPath, external: true };
            }
            if (shouldExternalizeBare) {
              return { path: veryfrontPath, external: true };
            }
            return { path: veryfrontPath, namespace: "https" };
          }
        }

        // Map bare imports to esm.sh with pinned React version.
        // IMPORTANT: Do NOT use external=react,react-dom here!
        // With external=, esm.sh outputs bare "import 'react'" which resolves to latest React at runtime.
        // Using deps= only, esm.sh resolves React internally to the pinned version URL.
        const url = `https://esm.sh/${args.path}?deps=react@${reactVersion},react-dom@${reactVersion}&target=es2022`;
        if (shouldExternalizeBare) {
          return { path: url, external: true };
        }
        return { path: url, namespace: "https" };
      });

      const shouldLoadHttps = !shouldExternalize || !shouldExternalizeBare;
      if (shouldLoadHttps) {
        // Resolve esm.sh internal paths
        build.onResolve({ filter: /^\//, namespace: "https" }, (args) => {
          const reactMatch = args.path.match(/\/(react)@[\d.]+/);
          if (reactMatch) {
            const reactUrl = reactMapping["react"];
            if (reactUrl) {
              return { path: reactUrl, external: shouldExternalize };
            }
          }

          const reactDomMatch = args.path.match(/\/(react-dom)@[\d.]+(.*)$/);
          if (reactDomMatch) {
            const subpathPart = reactDomMatch[2] || "";
            let mappingKey = "react-dom";
            if (subpathPart.includes("/client")) mappingKey = "react-dom/client";
            else if (subpathPart.includes("/server")) mappingKey = "react-dom/server";
            const reactDomUrl = reactMapping[mappingKey] || reactMapping["react-dom"];
            if (reactDomUrl) {
              return { path: reactDomUrl, external: shouldExternalize };
            }
          }

          try {
            const baseUrl = new URL(args.importer).origin;
            const resolvedUrl = `${baseUrl}${args.path}`;
            return { path: resolvedUrl, namespace: "https" };
          } catch {
            const resolvedUrl = `https://esm.sh${args.path}`;
            return { path: resolvedUrl, namespace: "https" };
          }
        });

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
            console.error("[BareImportPlugin] Fetch failed:", args.path, error);
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
 */
export function createMdxPlugin(
  projectDir: string,
  _adapter: RuntimeAdapter, // Adapter is unused - we read from virtualFiles only to avoid AsyncLocalStorage context loss
  target: "ssr" | "browser" = "ssr",
  virtualFiles?: Map<string, string>,
): Plugin {
  return {
    name: "veryfront-mdx",
    setup(build) {
      // Always route MDX files through mdx-virtual namespace.
      // We CANNOT use adapter.fs during esbuild plugin callbacks because
      // AsyncLocalStorage context is lost in esbuild's native code execution.
      // All MDX files must be pre-loaded into virtualFiles before building.
      build.onResolve({ filter: /\.mdx?$/ }, (args) => {
        let resolvedPath: string;

        if (args.path.startsWith("/")) {
          resolvedPath = args.path;
        } else {
          const basedir = args.resolveDir ||
            (args.importer ? getDirectory(args.importer) : projectDir);
          resolvedPath = joinPath(basedir, args.path);
        }

        // Try multiple path variations to handle path format inconsistencies
        // projectFiles map may use relative keys like "components/layouts/ArticleLayout.mdx"
        const relativeFromResolved = resolvedPath.startsWith(projectDir + "/")
          ? resolvedPath.slice(projectDir.length + 1)
          : resolvedPath.startsWith(projectDir)
            ? resolvedPath.slice(projectDir.length).replace(/^\//, "")
            : null;

        const pathVariations = [
          resolvedPath,
          resolvedPath.startsWith("/") ? resolvedPath.slice(1) : `/${resolvedPath}`,
          joinPath(projectDir, args.path.startsWith("/") ? args.path.slice(1) : args.path),
        ];

        // Add relative path variation (most likely to match for filesystem adapter)
        if (relativeFromResolved) {
          pathVariations.push(relativeFromResolved);
        }
        // Also try without leading ./ if present
        if (args.path.startsWith("./")) {
          pathVariations.push(args.path.slice(2));
        }

        for (const pathToTry of pathVariations) {
          if (virtualFiles?.has(pathToTry)) {
            return { path: pathToTry, namespace: "mdx-virtual" };
          }
        }

        // Always use mdx-virtual namespace - we'll handle missing files in onLoad
        return { path: resolvedPath, namespace: "mdx-virtual" };
      });

      build.onLoad({ filter: /\.mdx?$/, namespace: "mdx-virtual" }, async (args) => {
        try {
          // Try multiple path variations to handle path format inconsistencies
          // projectFiles map may use relative keys like "components/layouts/ArticleLayout.mdx"
          const relativeFromArgs = args.path.startsWith(projectDir + "/")
            ? args.path.slice(projectDir.length + 1)
            : args.path.startsWith(projectDir)
              ? args.path.slice(projectDir.length).replace(/^\//, "")
              : null;

          const pathVariations = [
            args.path,
            args.path.startsWith("/") ? args.path.slice(1) : `/${args.path}`,
            joinPath(projectDir, args.path.startsWith("/") ? args.path.slice(1) : args.path),
          ];

          // Add relative path variation (most likely to match for filesystem adapter)
          if (relativeFromArgs) {
            pathVariations.push(relativeFromArgs);
          }
          // Also try without leading ./ if present
          if (args.path.startsWith("./")) {
            pathVariations.push(args.path.slice(2));
          }

          let content: string | undefined;
          let resolvedPath = args.path;

          for (const pathToTry of pathVariations) {
            content = virtualFiles?.get(pathToTry);
            if (content !== undefined) {
              resolvedPath = pathToTry;
              break;
            }
          }

          if (content === undefined) {
            const availableKeys = virtualFiles ? [...virtualFiles.keys()].slice(0, 10) : [];
            return {
              errors: [{
                text: `Virtual MDX file not found: ${args.path}. ` +
                  `Tried: ${pathVariations.join(", ")}. ` +
                  `Available (first 10): ${availableKeys.join(", ")}`,
                location: null,
              }],
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
            resolvedPath,
            compilationTarget,
            undefined,
          );

          return {
            contents: result.compiledCode,
            loader: "jsx",
            resolveDir: getDirectory(resolvedPath),
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

      // Note: We intentionally do NOT have a fallback onLoad for adapter.fs.readFile()
      // because esbuild plugin callbacks run outside AsyncLocalStorage context,
      // causing "No request context available" errors with MultiProjectFSAdapter.
      // All MDX files must be pre-loaded into virtualFiles before building.
    },
  };
}

export function createHmrPlugin(projectId: string, hmrPort?: number): Plugin {
  return {
    name: "veryfront-hmr",
    setup(build) {
      build.onEnd((result) => {
        if (result.errors.length > 0) return;

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

  const bareImportPlugin = createBareImportPlugin({
    reactVersion,
    externalizeReact: true,
    reactFilePaths,
  });

  const plugins: Plugin[] = [
    createVirtualFsPlugin(projectDir, adapter),
    createMdxPlugin(projectDir, adapter, target),
    bareImportPlugin,
  ];

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
      external: external.filter((pkg) => !pkg.startsWith("react")),
      conditions: ["node", "import"],
    };
  }

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

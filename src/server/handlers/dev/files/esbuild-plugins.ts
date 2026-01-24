import type { OnLoadArgs, OnResolveArgs, Plugin, PluginBuild } from "esbuild";
// Direct import from base.ts to avoid circular dependency through barrel
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
import {
  computeIntegrity,
  createLockfileManager,
  type LockfileManager,
} from "#veryfront/utils/import-lockfile.ts";
import { serverLogger as logger } from "#veryfront/utils/logger/index.ts";

type EsbuildLoader = "tsx" | "ts" | "jsx" | "js";

function getLoaderForPath(path: string): EsbuildLoader {
  if (path.endsWith(".tsx")) return "tsx";
  if (path.endsWith(".ts")) return "ts";
  if (path.endsWith(".jsx")) return "jsx";
  return "js";
}

/** Create relative file system plugin for resolving imports via adapter's fs */
export function createRelativeFsPlugin(projectDir: string, adapter: RuntimeAdapter): Plugin {
  return {
    name: "veryfront-rel-fs",
    setup(build: PluginBuild) {
      const exts = [".tsx", ".ts", ".jsx", ".js", ".mjs"];

      build.onResolve({ filter: /^(\.?\.?\/|\/)\/*/ }, async (args: OnResolveArgs) => {
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
            // next
          }
        }

        return undefined;
      });

      build.onLoad({ filter: /\.(tsx?|jsx?|mjs)$/ }, async (args: OnLoadArgs) => {
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

/** Map of common packages to their esm.sh URLs for browser imports */
const ESM_PACKAGE_MAP: Record<string, string> = {
  react: getReactCDNUrl(REACT_DEFAULT_VERSION),
  "react-dom": getReactDOMCDNUrl(REACT_DEFAULT_VERSION),
  "react-dom/client": getReactDOMClientCDNUrl(REACT_DEFAULT_VERSION),
  "react/jsx-runtime": getReactJSXRuntimeCDNUrl(REACT_DEFAULT_VERSION),
  "react/jsx-dev-runtime": getReactJSXDevRuntimeCDNUrl(REACT_DEFAULT_VERSION),
};

export interface BareExternalPluginOptions {
  bundle?: boolean;
  lockfile?: LockfileManager;
  projectDir?: string;
  strict?: boolean;
}

function isBareImport(path: string): boolean {
  return !path.startsWith(".") &&
    !path.startsWith("/") &&
    !path.startsWith("http://") &&
    !path.startsWith("https://");
}

function toEsmUrl(path: string): string {
  return ESM_PACKAGE_MAP[path] ?? `https://esm.sh/${path}`;
}

function resolveAsExternalOrHttps(
  path: string,
  bundle: boolean,
): { path: string; external: true } | {
  path: string;
  namespace: "https";
} {
  if (bundle) return { path, namespace: "https" };
  return { path, external: true };
}

/** Create bare module external plugin that rewrites npm imports to esm.sh URLs */
export function createBareExternalPlugin(
  options: BareExternalPluginOptions | boolean = false,
): Plugin {
  const opts: BareExternalPluginOptions = typeof options === "boolean"
    ? { bundle: options }
    : options;
  const { bundle = false, strict = false } = opts;
  const lockfile = opts.lockfile ??
    (opts.projectDir && bundle ? createLockfileManager(opts.projectDir) : null);

  return {
    name: "veryfront-bare-ext",
    setup(build: PluginBuild) {
      build.onResolve({ filter: /.*/ }, (args: OnResolveArgs) => {
        if (!isBareImport(args.path)) return undefined;
        if (args.kind !== "import-statement" && args.kind !== "dynamic-import") return undefined;

        return resolveAsExternalOrHttps(toEsmUrl(args.path), bundle);
      });

      if (!bundle) return;

      build.onLoad({ filter: /.*/, namespace: "https" }, async (args: OnLoadArgs) => {
        if (lockfile) {
          const cached = await lockfile.get(args.path);
          if (cached) {
            logger.debug(`[bare-ext] lockfile hit: ${args.path}`);
            try {
              const response = await fetch(cached.resolved);
              if (response.ok) {
                const contents = await response.text();
                const integrity = await computeIntegrity(contents);

                if (integrity === cached.integrity) return { contents, loader: "js" };

                if (strict) {
                  return {
                    errors: [
                      {
                        text:
                          `Integrity mismatch for ${args.path}: expected ${cached.integrity}, got ${integrity}`,
                        location: null,
                      },
                    ],
                  };
                }

                logger.warn(`[bare-ext] integrity mismatch, refetching: ${args.path}`);
              }
            } catch {
              logger.warn(`[bare-ext] cached URL failed, refetching: ${args.path}`);
            }
          }
        }

        try {
          const response = await fetch(args.path, { redirect: "follow" });
          if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

          const contents = await response.text();
          const resolvedUrl = response.url || args.path;

          if (lockfile) {
            const integrity = await computeIntegrity(contents);
            await lockfile.set(args.path, {
              resolved: resolvedUrl,
              integrity,
              fetchedAt: new Date().toISOString(),
            });
            await lockfile.flush();
            logger.debug(`[bare-ext] lockfile updated: ${args.path} -> ${resolvedUrl}`);
          }

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
    },
  };
}

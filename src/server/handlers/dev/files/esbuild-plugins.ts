import type { OnLoadArgs, OnResolveArgs, Plugin, PluginBuild } from "esbuild";
import { NETWORK_ERROR } from "#veryfront/errors";
// Direct import from base.ts to avoid circular dependency through barrel
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { getDirectory, joinPath } from "#veryfront/utils/path-utils.ts";

import {
  computeIntegrity,
  createLockfileManager,
  type LockfileManager,
} from "#veryfront/utils/import-lockfile.ts";
import { serverLogger } from "#veryfront/utils/logger/index.ts";

const logger = serverLogger.component("bare-ext");

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
          } catch (_) {
            // expected: candidate path doesn't exist, try next
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

/**
 * Bare specifiers that should be kept as-is (not rewritten to esm.sh URLs).
 * These are resolved by the browser's import map injected in the HTML <head>.
 */
const DEFAULT_IMPORT_MAP_IMPORTS: Record<string, string> = {
  react: "",
  "react-dom": "",
  "react-dom/client": "",
  "react-dom/server": "",
  "react/jsx-runtime": "",
  "react/jsx-dev-runtime": "",
};

/** Map of common packages to their esm.sh URLs for browser imports */
const ESM_PACKAGE_MAP: Record<string, string> = {};

interface BareExternalPluginOptions {
  bundle?: boolean;
  lockfile?: LockfileManager;
  projectDir?: string;
  strict?: boolean;
  importMapImports?: Record<string, string>;
}

function isBareImport(path: string): boolean {
  return (
    !path.startsWith(".") &&
    !path.startsWith("/") &&
    !path.startsWith("http://") &&
    !path.startsWith("https://")
  );
}

function toEsmUrl(path: string): string {
  return ESM_PACKAGE_MAP[path] ?? `https://esm.sh/${path}`;
}

function isImportMapResolved(
  path: string,
  imports: Record<string, string>,
): boolean {
  if (imports[path]) return true;

  for (const key of Object.keys(imports)) {
    if (key.endsWith("/") && path.startsWith(key)) return true;
  }

  return false;
}

function resolveAsExternalOrHttps(
  path: string,
  bundle: boolean,
): { path: string; external: true } | { path: string; namespace: "https" } {
  if (bundle) return { path, namespace: "https" };
  return { path, external: true };
}

async function loadFromLockfile(
  lockfile: LockfileManager,
  url: string,
  strict: boolean,
): Promise<
  { contents: string; loader: "js" } | { errors: { text: string; location: null }[] } | null
> {
  const cached = await lockfile.get(url);
  if (!cached) return null;

  logger.debug(`lockfile hit: ${url}`);

  try {
    const response = await fetch(cached.resolved);
    if (!response.ok) return null;

    const contents = await response.text();
    const integrity = await computeIntegrity(contents);

    if (integrity === cached.integrity) return { contents, loader: "js" };

    if (strict) {
      return {
        errors: [
          {
            text: `Integrity mismatch for ${url}: expected ${cached.integrity}, got ${integrity}`,
            location: null,
          },
        ],
      };
    }

    logger.warn(`integrity mismatch, refetching: ${url}`);
    return null;
  } catch (_) {
    logger.warn(`cached URL failed, refetching: ${url}`);
    return null;
  }
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
  const importMapImports = {
    ...DEFAULT_IMPORT_MAP_IMPORTS,
    ...(opts.importMapImports ?? {}),
  };

  return {
    name: "veryfront-bare-ext",
    setup(build: PluginBuild) {
      build.onResolve({ filter: /.*/ }, (args: OnResolveArgs) => {
        if (!isBareImport(args.path)) return undefined;
        if (args.kind !== "import-statement" && args.kind !== "dynamic-import") return undefined;

        // Keep import-map-resolved specifiers as bare externals — the browser's
        // <script type="importmap"> resolves them to the correct CDN URL.
        if (isImportMapResolved(args.path, importMapImports)) {
          return { path: args.path, external: true };
        }

        return resolveAsExternalOrHttps(toEsmUrl(args.path), bundle);
      });

      if (!bundle) return;

      build.onLoad({ filter: /.*/, namespace: "https" }, async (args: OnLoadArgs) => {
        if (lockfile) {
          const cachedResult = await loadFromLockfile(lockfile, args.path, strict);
          if (cachedResult) return cachedResult;
        }

        try {
          const response = await fetch(args.path, { redirect: "follow" });
          if (!response.ok) {
            throw NETWORK_ERROR.create({
              detail: `HTTP ${response.status}: ${response.statusText}`,
            });
          }

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
            logger.debug(`lockfile updated: ${args.path} -> ${resolvedUrl}`);
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

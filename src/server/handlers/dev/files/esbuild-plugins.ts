import type { OnLoadArgs, OnResolveArgs, Plugin, PluginBuild } from "veryfront/extensions/bundler";
import { NETWORK_ERROR } from "#veryfront/errors";
// Direct import from base.ts to avoid circular dependency through barrel
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import {
  getDirectory,
  isWithinDirectory,
  joinPath,
  normalizePath,
} from "#veryfront/utils/path-utils.ts";

import {
  computeIntegrity,
  createLockfileManager,
  type LockfileManager,
} from "#veryfront/utils/import-lockfile.ts";
import {
  importMapOwnsSpecifier,
  mergeBrowserImportMapImports,
} from "#veryfront/utils/import-map.ts";
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
        // VULN-FS-6: NUL bytes are never legitimate in module paths.
        if (args.path.includes("\0")) {
          return {
            errors: [{ text: `Import path contains NUL byte: ${args.path}`, location: null }],
          };
        }

        const basedir = args.resolveDir ||
          (args.importer ? getDirectory(args.importer) : projectDir);
        // normalizePath collapses `./` and `foo/../` segments produced by
        // `joinPath` so downstream `adapter.fs.stat` lookups match the file
        // system's canonical key. Still inside the containment check below.
        const candidate = normalizePath(
          args.path.startsWith("/")
            ? joinPath(projectDir, args.path)
            : joinPath(basedir, args.path),
        );

        // VULN-FS-6: refuse anything that, after joining, escapes the project
        // root. esbuild plugins fire per-import; an entry file with
        // `import "../../../../etc/hostname"` would otherwise embed the file.
        if (!isWithinDirectory(projectDir, candidate)) {
          return {
            errors: [{
              text: `Import escapes project directory: ${args.path}`,
              location: null,
            }],
          };
        }

        const candidates: string[] = [candidate];
        for (const ext of exts) candidates.push(candidate + ext);
        for (const ext of exts) candidates.push(joinPath(candidate, `index${ext}`));

        for (const f of candidates) {
          // Defence in depth: each extension probe must also stay inside.
          if (!isWithinDirectory(projectDir, f)) continue;
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
        // VULN-FS-6: belt-and-braces — reject any onLoad call whose path
        // escapes the project root or carries a NUL byte. onResolve already
        // gates this, but esbuild can call onLoad with paths produced by
        // other plugins or namespaces.
        if (args.path.includes("\0")) {
          return {
            errors: [{ text: `Load path contains NUL byte: ${args.path}`, location: null }],
          };
        }
        if (!isWithinDirectory(projectDir, args.path)) {
          return {
            errors: [{
              text: `Load path escapes project directory: ${args.path}`,
              location: null,
            }],
          };
        }
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
  const importMapImports = mergeBrowserImportMapImports(opts.importMapImports);

  return {
    name: "veryfront-bare-ext",
    setup(build: PluginBuild) {
      build.onResolve({ filter: /.*/ }, (args: OnResolveArgs) => {
        if (!isBareImport(args.path)) return undefined;
        if (args.kind !== "import-statement" && args.kind !== "dynamic-import") return undefined;

        // Keep import-map-resolved specifiers as bare externals — the browser's
        // <script type="importmap"> resolves them to the correct CDN URL.
        if (importMapOwnsSpecifier(args.path, importMapImports)) {
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

export function createHttpExternalPlugin(): Plugin {
  return {
    name: "veryfront-http-ext",
    setup(build: PluginBuild) {
      build.onResolve({ filter: /^https?:\/\// }, (args: OnResolveArgs) => {
        if (args.kind !== "import-statement" && args.kind !== "dynamic-import") return undefined;
        return { path: args.path, external: true };
      });
    },
  };
}

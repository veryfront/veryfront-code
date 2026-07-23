import type { OnLoadArgs, OnResolveArgs, Plugin, PluginBuild } from "veryfront/extensions/bundler";
import { NETWORK_ERROR } from "#veryfront/errors";
// Direct import from base.ts to avoid circular dependency through barrel
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { wrapWithCurrentContext } from "#veryfront/platform/adapters/fs/veryfront/multi-project-adapter.ts";
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
import { serverLogger } from "#veryfront/utils";
import {
  describeBrowserModuleBoundaryViolation,
  inspectBrowserModuleBoundary,
} from "#veryfront/server/shared/browser-module-boundary.ts";
import { isNotFoundError } from "#veryfront/platform/compat/fs.ts";

const logger = serverLogger.component("bare-ext");

type EsbuildLoader = "tsx" | "ts" | "jsx" | "js";

const SCRIPT_EXTENSIONS = [
  ".tsx",
  ".ts",
  ".jsx",
  ".js",
  ".mts",
  ".mjs",
  ".cts",
  ".cjs",
] as const;
const SCRIPT_PATH_PATTERN = /\.(?:[jt]sx?|[cm][jt]s)$/i;
const PROJECT_FS_NAMESPACE = "veryfront-project-fs";

interface ProjectFsPluginData {
  absolutePath: string;
}

export interface RelativeFsPluginOptions {
  enforceBrowserBoundaries?: boolean;
}

function getLoaderForPath(path: string): EsbuildLoader {
  if (/\.tsx$/i.test(path)) return "tsx";
  if (/\.(?:ts|[cm]ts)$/i.test(path)) return "ts";
  if (/\.jsx$/i.test(path)) return "jsx";
  return "js";
}

export type BrowserModulePathStatus = "trusted" | "symlink" | "unavailable";

export async function inspectBrowserModulePath(
  projectDir: string,
  filePath: string,
  adapter: RuntimeAdapter,
): Promise<BrowserModulePathStatus> {
  const projectRoot = normalizePath(projectDir);
  const normalizedFilePath = normalizePath(filePath);
  if (!isWithinDirectory(projectRoot, normalizedFilePath)) return "unavailable";

  if (adapter.fs.realPath) {
    try {
      const canonicalProjectRoot = normalizePath(await adapter.fs.realPath(projectRoot));
      const canonicalFilePath = normalizePath(await adapter.fs.realPath(normalizedFilePath));
      if (!isWithinDirectory(canonicalProjectRoot, canonicalFilePath)) return "symlink";
    } catch {
      return "unavailable";
    }
  }

  const pathSegments = normalizedFilePath.slice(projectRoot.length).split("/").filter(Boolean);
  if (pathSegments.length === 0) return "unavailable";

  let parent = projectRoot;
  try {
    for (const [index, segment] of pathSegments.entries()) {
      let matchingEntry:
        | { isFile: boolean; isDirectory: boolean; isSymlink: boolean }
        | undefined;
      for await (const entry of adapter.fs.readDir(parent)) {
        if (entry.name === segment) {
          matchingEntry = entry;
          break;
        }
      }

      if (!matchingEntry) return "unavailable";
      if (matchingEntry.isSymlink) return "symlink";

      const isLast = index === pathSegments.length - 1;
      if (isLast ? !matchingEntry.isFile : !matchingEntry.isDirectory) {
        return "unavailable";
      }
      parent = normalizePath(joinPath(parent, segment));
    }
  } catch {
    return "unavailable";
  }

  return "trusted";
}

function dependencyPathError(status: Exclude<BrowserModulePathStatus, "trusted">) {
  return status === "symlink"
    ? "Browser dependency traverses a symbolic link"
    : "Browser dependency path metadata is unavailable";
}

function getProjectModuleIdentity(projectDir: string, filePath: string): string {
  const projectRoot = normalizePath(projectDir);
  const normalizedFilePath = normalizePath(filePath);
  const projectRelativePath = normalizedFilePath.slice(projectRoot.length).replace(/^\/+/, "");
  return `/${projectRelativePath}`;
}

function getProjectFsPluginPath(args: OnLoadArgs): string | null {
  const pluginData = args.pluginData as Partial<ProjectFsPluginData> | null | undefined;
  return typeof pluginData?.absolutePath === "string" ? pluginData.absolutePath : null;
}

/** Create relative file system plugin for resolving imports via adapter's fs */
export function createRelativeFsPlugin(
  projectDir: string,
  adapter: RuntimeAdapter,
  options: RelativeFsPluginOptions = {},
): Plugin {
  return {
    name: "veryfront-rel-fs",
    setup(build: PluginBuild) {
      // esbuild invokes plugin callbacks from its child-process message pump,
      // which does not inherit the caller's AsyncLocalStorage store. Re-enter
      // the request context captured at plugin setup so context-scoped
      // adapters (MultiProjectFSAdapter) can resolve the project.
      build.onResolve(
        { filter: /^(\.?\.?\/|\/)\/*/ },
        wrapWithCurrentContext(async (args: OnResolveArgs) => {
          // VULN-FS-6: NUL bytes are never legitimate in module paths.
          if (args.path.includes("\0")) {
            return {
              errors: [{ text: "Import path contains a NUL byte", location: null }],
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
                text: "Import leaves the project directory",
                location: null,
              }],
            };
          }

          const candidates: string[] = [candidate];
          for (const ext of SCRIPT_EXTENSIONS) candidates.push(candidate + ext);
          for (const ext of SCRIPT_EXTENSIONS) {
            candidates.push(joinPath(candidate, `index${ext}`));
          }

          for (const f of candidates) {
            // Defence in depth: each extension probe must also stay inside.
            if (!isWithinDirectory(projectDir, f)) continue;
            try {
              const st = await adapter.fs.stat(f);
              if (st.isFile) {
                if (options.enforceBrowserBoundaries) {
                  const pathStatus = await inspectBrowserModulePath(projectDir, f, adapter);
                  if (pathStatus !== "trusted") {
                    return {
                      errors: [{ text: dependencyPathError(pathStatus), location: null }],
                    };
                  }
                  return {
                    path: getProjectModuleIdentity(projectDir, f),
                    namespace: PROJECT_FS_NAMESPACE,
                    pluginData: { absolutePath: f } satisfies ProjectFsPluginData,
                  };
                }
                return { path: f };
              }
            } catch (error) {
              if (isNotFoundError(error)) continue;
              return {
                errors: [{
                  text: options.enforceBrowserBoundaries
                    ? "Browser dependency path metadata is unavailable"
                    : "Module dependency path metadata is unavailable",
                  location: null,
                }],
              };
            }
          }

          return undefined;
        }),
      );

      async function loadModule(
        filePath: string,
        enforceBrowserBoundaries: boolean,
      ) {
        // VULN-FS-6: belt-and-braces validation rejects any onLoad call whose path
        // escapes the project root or carries a NUL byte. onResolve already
        // gates this, but esbuild can call onLoad with paths produced by
        // other plugins or namespaces.
        if (filePath.includes("\0")) {
          return {
            errors: [{
              text: enforceBrowserBoundaries
                ? "Browser dependency path contains a NUL byte"
                : "Module load path contains a NUL byte",
              location: null,
            }],
          };
        }
        if (!isWithinDirectory(projectDir, filePath)) {
          return {
            errors: [{
              text: enforceBrowserBoundaries
                ? "Browser dependency escapes the project directory"
                : "Module load path leaves the project directory",
              location: null,
            }],
          };
        }
        if (enforceBrowserBoundaries) {
          const pathStatus = await inspectBrowserModulePath(projectDir, filePath, adapter);
          if (pathStatus !== "trusted") {
            return {
              errors: [{ text: dependencyPathError(pathStatus), location: null }],
            };
          }
        }
        try {
          const contents = await adapter.fs.readFile(filePath);
          if (enforceBrowserBoundaries) {
            const violation = await inspectBrowserModuleBoundary(contents, filePath);
            if (violation) {
              return {
                errors: [{
                  text: describeBrowserModuleBoundaryViolation(violation).replace(
                    "Browser module",
                    "Browser dependency",
                  ),
                  location: null,
                }],
              };
            }
          }
          return {
            contents,
            loader: getLoaderForPath(filePath),
            ...(enforceBrowserBoundaries
              ? { resolveDir: getDirectory(filePath), watchFiles: [filePath] }
              : {}),
          };
        } catch {
          return {
            errors: [
              {
                text: enforceBrowserBoundaries
                  ? "Failed to read browser dependency"
                  : "Failed to read module dependency",
                location: null,
              },
            ],
          };
        }
      }

      build.onLoad(
        { filter: SCRIPT_PATH_PATTERN, namespace: "file" },
        wrapWithCurrentContext((args: OnLoadArgs) => {
          return loadModule(args.path, false);
        }),
      );

      build.onLoad(
        { filter: SCRIPT_PATH_PATTERN, namespace: PROJECT_FS_NAMESPACE },
        wrapWithCurrentContext((args: OnLoadArgs) => {
          const absolutePath = getProjectFsPluginPath(args);
          if (!absolutePath) {
            return {
              errors: [{ text: "Browser dependency path metadata is unavailable", location: null }],
            };
          }
          return loadModule(absolutePath, true);
        }),
      );
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

  logger.debug("Dependency lockfile cache hit");

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
            text: "Dependency integrity check failed",
            location: null,
          },
        ],
      };
    }

    logger.warn("Dependency integrity mismatch, refetching");
    return null;
  } catch (_) {
    logger.warn("Cached dependency fetch failed, refetching");
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

        // Keep import-map-resolved specifiers as bare externals because the browser's
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
            logger.debug("Dependency lockfile updated");
          }

          return { contents, loader: "js" };
        } catch {
          return {
            errors: [
              {
                text: "Failed to fetch browser dependency",
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

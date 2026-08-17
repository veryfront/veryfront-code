import type { OnLoadArgs, OnResolveArgs, Plugin, PluginBuild } from "veryfront/extensions/bundler";
import { isVeryfrontError, NETWORK_ERROR, SERVER_ONLY_IN_CLIENT } from "#veryfront/errors";
import { isCanonicalNotFoundError } from "#veryfront/platform/compat/not-found-error.ts";
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
  getLockfileEntryForBuild,
  type LockfileManager,
  setLockfileEntryForBuild,
} from "#veryfront/utils/import-lockfile.ts";
import {
  importMapOwnsSpecifier,
  mergeBrowserImportMapImports,
} from "#veryfront/utils/import-map.ts";
import { resolveImport } from "#veryfront/modules/import-map/resolver.ts";
import { serverLogger } from "#veryfront/utils";
import {
  describeBrowserModuleBoundaryViolation,
  inspectBrowserModuleBoundary,
} from "#veryfront/server/shared/browser-module-boundary.ts";
import {
  type DependencyPinningSourceInput,
  resolveDependencyPinningSnapshot,
} from "#veryfront/transforms/esm/package-registry.ts";
import { resolveDependencyPinForImport } from "#veryfront/transforms/import-rewriter/dependency-resolution.ts";
import { assertNoConfiguredCommonJsBrowserImports } from "#veryfront/transforms/import-rewriter/commonjs-policy.ts";
import { parseBarePackageSpecifier } from "#veryfront/transforms/shared/package-specifier.ts";
import {
  describeServerExternalBrowserViolation,
  getConfiguredServerExternalPackage,
} from "#veryfront/transforms/shared/server-only-packages.ts";
import { appendSameOriginDependencyPinningPathKey } from "#veryfront/transforms/import-rewriter/url-builder.ts";

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
  serverExternalPackages?: readonly string[];
  /**
   * Root-bound, symlink-safe, bounded read authority for browser builds. When
   * supplied, the read itself replaces mutable directory-walk admission.
   */
  readBrowserModule?: (path: string) => Promise<string>;
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
                  if (!options.readBrowserModule) {
                    const pathStatus = await inspectBrowserModulePath(projectDir, f, adapter);
                    if (pathStatus !== "trusted") {
                      return {
                        errors: [{ text: dependencyPathError(pathStatus), location: null }],
                      };
                    }
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
              // Only a genuine missing candidate is a resolution miss.
              if (!isCanonicalNotFoundError(error)) throw error;
            }
          }

          return undefined;
        }),
      );

      async function loadModule(
        filePath: string,
        enforceBrowserBoundaries: boolean,
      ) {
        // VULN-FS-6: belt-and-braces — reject any onLoad call whose path
        // escapes the project root or carries a NUL byte. onResolve already
        // gates this, but esbuild can call onLoad with paths produced by
        // other plugins or namespaces.
        if (filePath.includes("\0")) {
          return {
            errors: [{
              text: enforceBrowserBoundaries
                ? "Browser dependency path contains a NUL byte"
                : `Load path contains NUL byte: ${filePath}`,
              location: null,
            }],
          };
        }
        if (!isWithinDirectory(projectDir, filePath)) {
          return {
            errors: [{
              text: enforceBrowserBoundaries
                ? "Browser dependency escapes the project directory"
                : `Load path escapes project directory: ${filePath}`,
              location: null,
            }],
          };
        }
        if (enforceBrowserBoundaries && !options.readBrowserModule) {
          const pathStatus = await inspectBrowserModulePath(projectDir, filePath, adapter);
          if (pathStatus !== "trusted") {
            return {
              errors: [{ text: dependencyPathError(pathStatus), location: null }],
            };
          }
        }
        try {
          const contents = enforceBrowserBoundaries && options.readBrowserModule
            ? await options.readBrowserModule(filePath)
            : await adapter.fs.readFile(filePath);
          if (enforceBrowserBoundaries) {
            try {
              await assertNoConfiguredCommonJsBrowserImports(contents, {
                filePath,
                projectDir,
                serverExternalPackages: options.serverExternalPackages,
              });
            } catch (error) {
              return {
                errors: [{
                  text: isVeryfrontError(error)
                    ? `[${error.slug}] ${error.message}`
                    : "Browser dependency could not be safely analyzed",
                  location: null,
                }],
              };
            }
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
        } catch (error) {
          return {
            errors: [
              {
                text: enforceBrowserBoundaries
                  ? "Failed to read browser dependency"
                  : `Failed to read ${filePath}: ${String(error)}`,
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

/**
 * Build an esm.sh URL for a bare specifier, injecting a pinned version when
 * dependency pinning is enabled and the captured declaration is exact.
 * Raw declarations retain the unversioned URL while the platform resolves
 * them asynchronously.
 */
function buildPinnedEsmUrl(
  path: string,
  projectDir: string | undefined,
  projectId: string | undefined,
  dependencyPinningCacheKey?: string,
  dependencyPinningDependencies?: Readonly<Record<string, string>>,
  dependencyPinningSource?: DependencyPinningSourceInput,
): string {
  const parsed = parseBarePackageSpecifier(path);
  if (parsed && !parsed.version) {
    const version = resolveDependencyPinForImport(parsed.packageName, {
      projectDir,
      projectId,
      dependencyPinningCacheKey,
      dependencyPinningDependencies,
      dependencyPinningSource,
    });
    if (version) {
      const versionedPath = `${parsed.packageName}@${version}${parsed.subpath ?? ""}`;
      return `https://esm.sh/${versionedPath}`;
    }
  }
  return `https://esm.sh/${path}`;
}

function observeImportMapDependency(
  path: string,
  options: BareExternalPluginOptions,
  dependencyPinningCacheKey?: string,
  dependencyPinningDependencies?: Readonly<Record<string, string>>,
): void {
  const parsed = parseBarePackageSpecifier(path);
  if (
    parsed?.version ||
    (
      parsed?.packageName !== "react" &&
      parsed?.packageName !== "react-dom" &&
      parsed?.packageName !== "veryfront"
    )
  ) {
    return;
  }

  resolveDependencyPinForImport(parsed.packageName, {
    projectDir: options.projectDir,
    projectId: options.projectId,
    dependencyPinningCacheKey,
    dependencyPinningDependencies,
    dependencyPinningSource: options.dependencyPinningSource,
  });
}

interface BareExternalPluginOptions {
  bundle?: boolean;
  lockfile?: LockfileManager;
  projectDir?: string;
  projectId?: string;
  dependencyPinningCacheKey?: string;
  dependencyPinningDependencies?: Readonly<Record<string, string>>;
  dependencyPinningSource?: DependencyPinningSourceInput;
  strict?: boolean;
  importMapImports?: Record<string, string>;
  /** Bare npm package roots explicitly declared as server-only by the project. */
  serverExternalPackages?: readonly string[];
}

function isBareImport(path: string): boolean {
  return (
    !path.startsWith(".") &&
    !path.startsWith("/") &&
    !/^https?:\/\//i.test(path)
  );
}

/**
 * A Node built-in module specifier (`node:crypto`, `node:fs`, …). These are
 * server-only and must never be rewritten to an esm.sh URL for a browser bundle.
 */
function isNodeBuiltinSpecifier(path: string): boolean {
  return path === "node" || path.startsWith("node:");
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
  // A newer-format lockfile keeps failing the build loudly; an unreadable or
  // malformed lockfile degrades to a cache miss with a logged remedy.
  const cached = await getLockfileEntryForBuild(lockfile, url);
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

function describePersistenceError(error: unknown): string {
  if (!(error instanceof Error)) return typeof error;

  const code = (error as { code?: unknown }).code;
  const name = error.name || "Error";
  return typeof code === "string" && code ? `${name}(${code})` : name;
}

function isReadOnlyFileSystemError(error: unknown): boolean {
  if (error == null) return false;

  const message = error instanceof Error ? error.message : String(error);
  if (/read-only file ?system|os error 30|erofs/i.test(message)) return true;

  return error instanceof Error && isReadOnlyFileSystemError(error.cause);
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

  // Capture the dependency snapshot once at plugin creation. Every onResolve
  // callback awaits this same promise so import-map and esm.sh branches observe
  // one immutable key/map pair.
  const dependencySnapshot = opts.projectDir
    ? resolveDependencyPinningSnapshot(
      opts.dependencyPinningSource ?? opts.projectDir,
      opts.dependencyPinningCacheKey,
      opts.dependencyPinningDependencies,
    )
    : Promise.resolve(undefined);

  return {
    name: "veryfront-bare-ext",
    setup(build: PluginBuild) {
      build.onResolve({ filter: /.*/ }, async (args: OnResolveArgs) => {
        if (!isBareImport(args.path)) return undefined;
        const isEsmImport = args.kind === "import-statement" || args.kind === "dynamic-import";
        const isCommonJsImport = args.kind === "require-call" || args.kind === "require-resolve";
        if (!isEsmImport && !isCommonJsImport) return undefined;

        // Fail closed on Node built-ins. This plugin only runs for browser
        // bundles (platform: "browser"), where a server-only `node:*` import can
        // never work: rewriting it to an esm.sh URL silently ships a module that
        // 404s on esm.sh and throws (e.g. `createHash is not a function`) at
        // hydration. Surface a clear build error instead of a broken rewrite.
        if (isNodeBuiltinSpecifier(args.path)) {
          return {
            errors: [{
              text: `Cannot bundle server-only import "${args.path}" for the browser. ` +
                `Node built-in modules are not available on the client. Move it into a ` +
                `server component, an API route, or middleware — or gate the code behind a ` +
                `"use client" boundary that does not import it.`,
            }],
          };
        }

        const configuredPackage = getConfiguredServerExternalPackage(
          args.path,
          opts.serverExternalPackages,
        );
        if (configuredPackage !== undefined) {
          const violation = describeServerExternalBrowserViolation(
            args.path,
            args.importer || undefined,
            opts.projectDir,
          );
          return {
            errors: [{
              text: `[${SERVER_ONLY_IN_CLIENT.slug}] ${violation.message}`,
            }],
          };
        }

        // Preserve the existing handling of undeclared CommonJS imports. The
        // policy only makes explicit server-only declarations fail loudly.
        if (!isEsmImport) return undefined;

        // Ensure the package.json dep cache is warm before consulting it for
        // a version pin. The warmup Promise resolves immediately on warm paths.
        const snapshot = await dependencySnapshot;

        // Keep import-map-resolved specifiers as bare externals — the browser's
        // <script type="importmap"> resolves them to the correct CDN URL. React
        // and Veryfront still need to report their raw declarations before this
        // winning branch returns.
        if (importMapOwnsSpecifier(args.path, importMapImports)) {
          const mappedSpecifier = resolveImport(args.path, { imports: importMapImports });
          const mappedConfiguredPackage = getConfiguredServerExternalPackage(
            mappedSpecifier,
            opts.serverExternalPackages,
          );
          if (mappedConfiguredPackage !== undefined) {
            const violation = describeServerExternalBrowserViolation(
              mappedSpecifier,
              args.importer || undefined,
              opts.projectDir,
            );
            return {
              errors: [{
                text: `[${SERVER_ONLY_IN_CLIENT.slug}] ${violation.message}`,
              }],
            };
          }
          observeImportMapDependency(
            args.path,
            opts,
            snapshot?.cacheKey ?? opts.dependencyPinningCacheKey,
            snapshot?.dependencies ?? opts.dependencyPinningDependencies,
          );
          return { path: args.path, external: true };
        }

        return resolveAsExternalOrHttps(
          buildPinnedEsmUrl(
            args.path,
            opts.projectDir,
            opts.projectId,
            snapshot?.cacheKey,
            snapshot?.dependencies,
            opts.dependencyPinningSource,
          ),
          bundle,
        );
      });

      if (!bundle) return;

      let lockfileFlushDisabled = false;

      async function persistLockfileEntry(
        url: string,
        entry: {
          resolved: string;
          integrity: string;
          fetchedAt: string;
        },
      ): Promise<void> {
        if (!lockfile) return;

        // An unreadable lockfile skips persistence instead of failing the
        // refetched load; the file stays intact for `veryfront lock --clear`.
        const staged = await setLockfileEntryForBuild(lockfile, url, entry);
        if (!staged || lockfileFlushDisabled) return;

        try {
          await lockfile.flush();
          logger.debug(`lockfile updated: ${url} -> ${entry.resolved}`);
        } catch (error) {
          if (!isReadOnlyFileSystemError(error)) throw error;
          lockfileFlushDisabled = true;
          logger.debug(
            `lockfile flush disabled on read-only filesystem for ${url}: ${
              describePersistenceError(error)
            }`,
          );
        }
      }

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
            await persistLockfileEntry(args.path, {
              resolved: resolvedUrl,
              integrity,
              fetchedAt: new Date().toISOString(),
            });
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

interface HttpExternalPluginOptions {
  moduleServerOrigin?: string;
  dependencyPinningCacheKey?: string;
  projectDir?: string;
  serverExternalPackages?: readonly string[];
}

export function createHttpExternalPlugin(options: HttpExternalPluginOptions = {}): Plugin {
  return {
    name: "veryfront-http-ext",
    setup(build: PluginBuild) {
      build.onResolve({ filter: /^(?:https?:)?\/\//i }, (args: OnResolveArgs) => {
        if (args.kind !== "import-statement" && args.kind !== "dynamic-import") return undefined;
        const configuredPackage = getConfiguredServerExternalPackage(
          args.path,
          options.serverExternalPackages,
        );
        if (configuredPackage !== undefined) {
          const violation = describeServerExternalBrowserViolation(
            args.path,
            args.importer || undefined,
            options.projectDir,
          );
          return {
            errors: [{
              text: `[${SERVER_ONLY_IN_CLIENT.slug}] ${violation.message}`,
            }],
          };
        }
        return {
          path: appendSameOriginDependencyPinningPathKey(
            args.path,
            options.dependencyPinningCacheKey,
            options.moduleServerOrigin,
          ),
          external: true,
        };
      });
    },
  };
}

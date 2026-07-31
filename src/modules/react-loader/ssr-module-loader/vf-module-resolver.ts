/**
 * VF module resolver for SSR transformed code.
 *
 * Extracts and resolves /_vf_modules/* imports into file:// cache paths.
 */

import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { DependencyPinningSourceInput } from "#veryfront/transforms/esm/package-registry.ts";
import { rendererLogger } from "#veryfront/utils";
import { parseImports, replaceSpecifiers } from "#veryfront/transforms/esm/lexer.ts";
import { getMdxEsmSsrCacheDir } from "#veryfront/transforms/mdx/esm-module-loader/cache/index.ts";
import {
  createModuleFetcherContext,
  fetchAndCacheModule,
} from "#veryfront/transforms/mdx/esm-module-loader/module-fetcher/index.ts";
import type { SSRImportMapIdentity } from "./import-map-identity.ts";
import { toFileUrl } from "#veryfront/compat/path/index.ts";
import { createError, toError } from "#veryfront/errors";

const logger = rendererLogger.component("ssr-module-loader");
const MAX_VF_MODULE_IMPORTS = 500;
const MAX_VF_MODULE_PATH_LENGTH = 4_096;
const MAX_VF_MODULE_FAILURE_DETAILS = 50;

interface VfModuleImport {
  specifier: string;
  path: string;
}

interface ResolveVfModuleImportsOptions {
  filePath: string;
  projectId: string;
  contentSourceId: string;
  adapter: RuntimeAdapter;
  projectDir: string;
  reactVersion?: string;
  /** Atomic map/cache identity already bound to the authenticated render source. */
  importMapIdentity?: SSRImportMapIdentity;
  moduleServerOrigin?: string;
  dependencyPinningCacheKey?: string;
  dependencyPinningDependencies?: Readonly<Record<string, string>>;
  dependencyPinningSource?: DependencyPinningSourceInput;
}

interface ResolveVfModuleImportsDependencies {
  fetchAndCacheModule?: typeof fetchAndCacheModule;
}

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function assertSafeVfModulePath(path: string): string {
  if (
    path.length === 0 ||
    path.length > MAX_VF_MODULE_PATH_LENGTH ||
    !path.startsWith("_vf_modules/") ||
    path.includes("\\") ||
    containsControlCharacter(path)
  ) {
    throw new TypeError("Invalid _vf_modules import path");
  }

  const segments = path.split("/");
  if (segments.some((segment) => segment.length === 0)) {
    throw new TypeError("Invalid _vf_modules import path");
  }
  for (const segment of segments) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      throw new TypeError("Invalid _vf_modules import path encoding");
    }
    if (
      decoded === "." ||
      decoded === ".." ||
      decoded.includes("/") ||
      decoded.includes("\\") ||
      containsControlCharacter(decoded)
    ) {
      throw new TypeError("Unsafe _vf_modules import path segment");
    }
  }
  return path;
}

/**
 * Find /_vf_modules/ imports in transformed code.
 * Matches both /_vf_modules/... and file:///_vf_modules/... forms.
 */
export async function findVfModuleImports(code: string): Promise<VfModuleImport[]> {
  const imports: VfModuleImport[] = [];
  const parsedImports = await parseImports(code);

  for (const importSpecifier of parsedImports) {
    const rawPath = importSpecifier.n;
    if (!rawPath) continue;

    // Normalize "file:///_vf_modules/..." and "/_vf_modules/..." to "_vf_modules/..."
    const path = rawPath.replace(/^(?:file:\/\/)?\/+/, "");
    if (!path.startsWith("_vf_modules/")) continue;

    const queryStart = path.search(/[?#]/);
    imports.push({
      specifier: rawPath,
      path: queryStart === -1 ? path : path.slice(0, queryStart),
    });
  }

  return imports;
}

/**
 * Resolve /_vf_modules/ imports to local cached modules and rewrite code.
 */
export async function resolveVfModuleImports(
  code: string,
  options: ResolveVfModuleImportsOptions,
  dependencies: ResolveVfModuleImportsDependencies = {},
): Promise<string> {
  const imports = await findVfModuleImports(code);
  if (imports.length === 0) return code;
  if (imports.length > MAX_VF_MODULE_IMPORTS) {
    throw new RangeError(
      `SSR module contains too many _vf_modules imports (${imports.length}, max ${MAX_VF_MODULE_IMPORTS})`,
    );
  }

  logger.debug("Processing _vf_modules imports", {
    file: options.filePath.slice(-40),
    count: imports.length,
    paths: imports.map((i) => i.path).slice(0, 5),
  });

  const esmCacheDir = getMdxEsmSsrCacheDir(options.projectId, options.contentSourceId);

  const fetcherContext = createModuleFetcherContext(
    esmCacheDir,
    options.adapter,
    options.projectDir,
    options.projectId,
    {
      contentSourceId: options.contentSourceId,
      importMap: options.importMapIdentity?.importMap,
      importMapFingerprint: options.importMapIdentity?.fingerprint,
      reactVersion: options.reactVersion,
      moduleServerOrigin: options.moduleServerOrigin,
      dependencyPinningCacheKey: options.dependencyPinningCacheKey,
      dependencyPinningDependencies: options.dependencyPinningDependencies,
      dependencyPinningSource: options.dependencyPinningSource,
      projectSlug: options.projectId,
      strictMissingModules: true,
    },
  );

  const specifiersByPath = new Map<string, string[]>();
  for (const { specifier, path: rawPath } of imports) {
    const path = assertSafeVfModulePath(rawPath);
    const specifiers = specifiersByPath.get(path);
    if (specifiers) specifiers.push(specifier);
    else specifiersByPath.set(path, [specifier]);
  }

  const results = await Promise.all(
    Array.from(specifiersByPath.entries()).map(async ([path, specifiers]) => {
      try {
        const cachedFilePath = await (
          dependencies.fetchAndCacheModule ?? fetchAndCacheModule
        )(path, fetcherContext);
        return { specifiers, path, cachedFilePath, error: undefined };
      } catch (error) {
        logger.warn("Failed to fetch _vf_modules import", {
          file: options.filePath.slice(-40),
          path,
          error: error instanceof Error ? error.message : String(error),
        });
        return { specifiers, path, cachedFilePath: null, error };
      }
    }),
  );

  const replacements = new Map<string, string>();
  const failures: Array<{
    specifiers: readonly string[];
    path: string;
    reason: string;
  }> = [];
  for (const { specifiers, path, cachedFilePath, error } of results) {
    if (cachedFilePath) {
      const replacement = toFileUrl(cachedFilePath).href;
      for (const specifier of specifiers) {
        replacements.set(specifier, replacement);
      }
    } else {
      logger.warn("Failed to resolve _vf_modules import", {
        file: options.filePath.slice(-40),
        path,
      });
      failures.push({
        specifiers,
        path,
        reason: error instanceof Error
          ? error.message.slice(0, 512)
          : error === undefined
          ? "Module fetch returned no cache path"
          : String(error).slice(0, 512),
      });
    }
  }

  if (failures.length > 0) {
    const reportedFailures = failures.slice(
      0,
      MAX_VF_MODULE_FAILURE_DETAILS,
    );
    const omittedFailures = failures.length - reportedFailures.length;
    throw toError(
      createError({
        type: "build",
        message: `Failed to resolve ${failures.length} _vf_modules import${
          failures.length === 1 ? "" : "s"
        }: ${reportedFailures.map(({ path, reason }) => `${path} (${reason})`).join(", ")}${
          omittedFailures > 0 ? `, … ${omittedFailures} additional failures omitted` : ""
        }`,
        context: {
          file: options.filePath,
          phase: "dependency-resolution",
          missing: reportedFailures.flatMap(({ specifiers, reason }) =>
            specifiers.map((specifier) => ({
              specifier,
              fromFile: options.filePath,
              reason,
            }))
          ),
        },
      }),
    );
  }

  return await replaceSpecifiers(code, (specifier) => replacements.get(specifier) ?? null);
}

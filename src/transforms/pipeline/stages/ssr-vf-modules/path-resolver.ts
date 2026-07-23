/**
 * Framework path resolution for the SSR VF Modules stage.
 *
 * Resolves /_vf_modules/ paths and #veryfront/ specifiers to actual
 * framework source files on disk.
 */

import { createFileSystem, exists } from "#veryfront/platform/compat/fs.ts";
import { join } from "#veryfront/compat/path/index.ts";
import { rendererLogger as logger } from "#veryfront/utils";
import {
  isSafeFrameworkSourceKey,
  resolveRelativeFrameworkSourceImport,
} from "#veryfront/platform/compat/framework-source-resolver.ts";
import { isWithinDirectory } from "#veryfront/utils/path-utils.ts";
import { resolveInternalModuleTarget } from "../../../veryfront-module-urls.ts";
import { EXTENSIONS, FRAMEWORK_LOOKUPS, LOG_PREFIX } from "./constants.ts";
import { fileLogLabel } from "../../../shared/log-context.ts";

export async function tryReadWithExtensions(
  fs: ReturnType<typeof createFileSystem>,
  basePath: string,
  existsFn: (path: string) => Promise<boolean> = exists,
): Promise<{ sourcePath: string; content: string } | null> {
  // Try all extensions, including .src versions for embedded sources
  const allExtensions = [
    ...EXTENSIONS.map((ext) => ext + ".src"), // Embedded sources (.tsx.src, .ts.src, etc.)
    ...EXTENSIONS, // Regular sources (.tsx, .ts, etc.)
  ];

  for (const ext of allExtensions) {
    const sourcePath = basePath + ext;
    try {
      if (await existsFn(sourcePath)) {
        const content = await fs.readTextFile(sourcePath);
        return { sourcePath, content };
      }
    } catch (_) {
      /* expected: file may not exist at this extension */
    }
  }
  return null;
}

/**
 * Resolve a /_vf_modules/ path to the actual framework source file.
 */
export async function resolveFrameworkFile(
  vfModulePath: string,
  fs: ReturnType<typeof createFileSystem>,
  existsFn: (path: string) => Promise<boolean> = exists,
): Promise<{ sourcePath: string; content: string } | null> {
  const normalizedVfModulePath = vfModulePath.replace(/^file:\/\/(?=\/_vf_modules\/)/, "");

  const pathWithoutPrefix = normalizedVfModulePath
    .replace(/^\/_vf_modules\//, "")
    .replace(/\?.*$/, "")
    .replace(/\.js$/, "");

  const frameworkRelativePath = pathWithoutPrefix.startsWith("_veryfront/")
    ? pathWithoutPrefix.slice("_veryfront/".length)
    : pathWithoutPrefix;
  if (!isSafeFrameworkSourceKey(frameworkRelativePath)) return null;

  logger.debug(`${LOG_PREFIX} resolveFrameworkFile`, {
    moduleFile: fileLogLabel(pathWithoutPrefix),
    lookupCount: FRAMEWORK_LOOKUPS.length,
  });

  for (const [prefix, frameworkDir] of FRAMEWORK_LOOKUPS) {
    if (!pathWithoutPrefix.startsWith(prefix)) {
      logger.debug(`${LOG_PREFIX} Skipping lookup - path doesn't start with prefix`, {
        prefix,
      });
      continue;
    }

    const relativePath = pathWithoutPrefix.slice(prefix.length);
    const pathWithPrefixDir = join(frameworkDir, prefix, relativePath);
    if (!isWithinDirectory(frameworkDir, pathWithPrefixDir)) continue;

    logger.debug(`${LOG_PREFIX} Trying path with prefix`, {
      prefix,
      moduleFile: fileLogLabel(relativePath),
    });

    const withPrefix = await tryReadWithExtensions(fs, pathWithPrefixDir, existsFn);
    if (withPrefix) {
      logger.debug(`${LOG_PREFIX} Found with prefix`, {
        prefix,
        moduleFile: fileLogLabel(relativePath),
      });
      return withPrefix;
    }

    if (prefix !== "_veryfront/") continue;

    const pathWithoutPrefixDir = join(frameworkDir, relativePath);
    if (!isWithinDirectory(frameworkDir, pathWithoutPrefixDir)) continue;
    logger.debug(`${LOG_PREFIX} Trying path without prefix`, {
      moduleFile: fileLogLabel(relativePath),
    });

    const withoutPrefix = await tryReadWithExtensions(fs, pathWithoutPrefixDir, existsFn);
    if (withoutPrefix) {
      logger.debug(`${LOG_PREFIX} Found without prefix`, {
        prefix,
        moduleFile: fileLogLabel(relativePath),
      });
      return withoutPrefix;
    }
  }

  logger.warn(`${LOG_PREFIX} resolveFrameworkFile: not found`, {
    moduleFile: fileLogLabel(pathWithoutPrefix),
  });

  return null;
}

/**
 * Resolve a #veryfront/ import to the actual framework source file path.
 * Returns the resolved path if found, null otherwise.
 *
 * Uses the same runtime-aware lookup order as resolveFrameworkFile so cycle
 * detection and source selection always agree.
 */
export async function resolveVeryfrontSourcePath(
  specifier: string,
  existsFn: (path: string) => Promise<boolean> = exists,
): Promise<string | null> {
  if (!specifier.startsWith("#veryfront/")) return null;

  const mappedTarget = resolveInternalModuleTarget(specifier);
  if (!mappedTarget?.startsWith("./src/")) return null;

  const relativePath = mappedTarget.slice("./src/".length);
  const hasExtension = /\.(tsx?|jsx?|mjs)$/.test(relativePath);

  const lookupDirs = FRAMEWORK_LOOKUPS.map(([, frameworkDir]) => frameworkDir);

  for (const dir of lookupDirs) {
    const basePath = join(dir, relativePath);

    if (hasExtension) {
      // Try exact path with .src suffix first (for embedded sources)
      try {
        const srcPath = basePath + ".src";
        if (await existsFn(srcPath)) return srcPath;
      } catch (_) {
        /* expected: file may not exist at this path */
      }
      // Try exact path
      try {
        if (await existsFn(basePath)) return basePath;
      } catch (_) {
        /* expected: file may not exist at this path */
      }
      continue;
    }

    // No extension provided - try all extensions
    // For embedded sources, try .src suffixes first
    const allExtensions = [
      ...EXTENSIONS.map((ext) => ext + ".src"),
      ...EXTENSIONS,
    ];

    for (const ext of allExtensions) {
      const pathWithExt = basePath + ext;
      try {
        if (await existsFn(pathWithExt)) return pathWithExt;
      } catch (_) {
        /* expected: file may not exist at this path */
      }
    }

    // Try index file
    for (const ext of allExtensions) {
      const indexPath = join(basePath, "index" + ext);
      try {
        if (await existsFn(indexPath)) return indexPath;
      } catch (_) {
        /* expected: file may not exist at this path */
      }
    }
  }

  return null;
}

/**
 * Resolve a relative import path to an absolute framework source path.
 * Given sourcePath=/foo/bar/index.ts and specifier=./Head.tsx, returns /foo/bar/Head.tsx
 *
 * Handles both regular source files (.tsx, .ts) and embedded sources (.tsx.src, .ts.src)
 * for compiled binaries.
 */
export async function resolveRelativeFrameworkImport(
  specifier: string,
  fromSourcePath: string,
  fs: ReturnType<typeof createFileSystem>,
  existsFn: (path: string) => Promise<boolean> = exists,
): Promise<string | null> {
  return await resolveRelativeFrameworkSourceImport(specifier, fromSourcePath, {
    fileSystem: fs,
    exists: existsFn,
    extensions: [
      ...EXTENSIONS.map((ext) => `${ext}.src`),
      ...EXTENSIONS,
    ],
  });
}

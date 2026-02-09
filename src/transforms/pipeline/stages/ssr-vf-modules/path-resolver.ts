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
  EMBEDDED_SRC_DIR,
  EXTENSIONS,
  FRAMEWORK_LOOKUPS,
  FRAMEWORK_ROOT,
  LOG_PREFIX,
} from "./constants.ts";

export async function tryReadWithExtensions(
  fs: ReturnType<typeof createFileSystem>,
  basePath: string,
): Promise<{ sourcePath: string; content: string } | null> {
  // Try all extensions, including .src versions for embedded sources
  const allExtensions = [
    ...EXTENSIONS.map((ext) => ext + ".src"), // Embedded sources (.tsx.src, .ts.src, etc.)
    ...EXTENSIONS, // Regular sources (.tsx, .ts, etc.)
  ];

  for (const ext of allExtensions) {
    const sourcePath = basePath + ext;
    try {
      if (await exists(sourcePath)) {
        const content = await fs.readTextFile(sourcePath);
        return { sourcePath, content };
      }
    } catch {
      // Continue trying other extensions
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
): Promise<{ sourcePath: string; content: string } | null> {
  const pathWithoutPrefix = vfModulePath
    .replace(/^\/_vf_modules\//, "")
    .replace(/\?.*$/, "")
    .replace(/\.js$/, "");

  logger.debug(`${LOG_PREFIX} resolveFrameworkFile`, {
    input: vfModulePath,
    pathWithoutPrefix,
    lookupDirs: FRAMEWORK_LOOKUPS.map(([p, d]) => ({ prefix: p, dir: d })),
  });

  for (const [prefix, frameworkDir] of FRAMEWORK_LOOKUPS) {
    if (!pathWithoutPrefix.startsWith(prefix)) {
      logger.debug(`${LOG_PREFIX} Skipping lookup - path doesn't start with prefix`, {
        prefix,
        pathWithoutPrefix,
      });
      continue;
    }

    const relativePath = pathWithoutPrefix.slice(prefix.length);
    const pathWithPrefixDir = join(frameworkDir, prefix, relativePath);

    logger.debug(`${LOG_PREFIX} Trying path with prefix`, {
      prefix,
      frameworkDir,
      relativePath,
      fullPath: pathWithPrefixDir,
    });

    const withPrefix = await tryReadWithExtensions(fs, pathWithPrefixDir);
    if (withPrefix) {
      logger.debug(`${LOG_PREFIX} Found with prefix`, { sourcePath: withPrefix.sourcePath });
      return withPrefix;
    }

    if (prefix !== "_veryfront/") continue;

    const pathWithoutPrefixDir = join(frameworkDir, relativePath);
    logger.debug(`${LOG_PREFIX} Trying path without prefix`, {
      frameworkDir,
      relativePath,
      fullPath: pathWithoutPrefixDir,
    });

    const withoutPrefix = await tryReadWithExtensions(fs, pathWithoutPrefixDir);
    if (withoutPrefix) {
      logger.debug(`${LOG_PREFIX} Found without prefix`, { sourcePath: withoutPrefix.sourcePath });
      return withoutPrefix;
    }
  }

  logger.warn(`${LOG_PREFIX} resolveFrameworkFile: not found`, {
    vfModulePath,
    pathWithoutPrefix,
    frameworkRoot: FRAMEWORK_ROOT,
    embeddedSrcDir: EMBEDDED_SRC_DIR,
  });

  return null;
}

/**
 * Resolve a #veryfront/ import to the actual framework source file path.
 * Returns the resolved path if found, null otherwise.
 *
 * IMPORTANT: This function checks embedded sources FIRST (for compiled binaries),
 * then falls back to regular src/. This matches resolveFrameworkFile's behavior
 * and ensures consistent path resolution for cycle detection.
 */
export async function resolveVeryfrontSourcePath(specifier: string): Promise<string | null> {
  if (!specifier.startsWith("#veryfront/")) return null;

  const relativePath = specifier.slice("#veryfront/".length);
  const hasExtension = /\.(tsx?|jsx?|mjs)$/.test(relativePath);

  // Check embedded sources first (for compiled binaries), then regular src/
  // This order matches FRAMEWORK_LOOKUPS and resolveFrameworkFile to ensure
  // consistent path resolution across the codebase, which is critical for
  // cycle detection in transformingFiles.
  const lookupDirs = [
    EMBEDDED_SRC_DIR, // Embedded sources for compiled binaries (.src files)
    join(FRAMEWORK_ROOT, "src"), // Regular sources for dev mode
  ];

  for (const dir of lookupDirs) {
    const basePath = join(dir, relativePath);

    if (hasExtension) {
      // Try exact path with .src suffix first (for embedded sources)
      try {
        const srcPath = basePath + ".src";
        if (await exists(srcPath)) return srcPath;
      } catch {
        // Continue
      }
      // Try exact path
      try {
        if (await exists(basePath)) return basePath;
      } catch {
        // Continue
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
        if (await exists(pathWithExt)) return pathWithExt;
      } catch {
        // Continue
      }
    }

    // Try index file
    for (const ext of allExtensions) {
      const indexPath = join(basePath, "index" + ext);
      try {
        if (await exists(indexPath)) return indexPath;
      } catch {
        // Continue
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
  _fs: ReturnType<typeof createFileSystem>,
): Promise<string | null> {
  const fromDir = fromSourcePath.substring(0, fromSourcePath.lastIndexOf("/"));
  const parts = fromDir.split("/").filter(Boolean);
  const importParts = specifier.split("/").filter(Boolean);

  for (const part of importParts) {
    if (part === "..") {
      parts.pop();
    } else if (part !== ".") {
      parts.push(part);
    }
  }

  const basePath = "/" + parts.join("/");

  // If specifier already has extension (e.g., ./Head.tsx), we need to try:
  // 1. The exact path (basePath)
  // 2. The path with .src suffix (basePath.src) for embedded sources
  // 3. Fall back to extension probing
  if (/\.(tsx?|jsx?|mjs)$/.test(specifier)) {
    // Try exact path first
    try {
      if (await exists(basePath)) return basePath;
    } catch {
      // Continue
    }

    // Try with .src suffix for embedded sources
    try {
      const srcPath = basePath + ".src";
      if (await exists(srcPath)) return srcPath;
    } catch {
      // Continue
    }

    // Not found with explicit extension
    return null;
  }

  // No extension provided - try all extensions (including .src for embedded sources)
  const allExtensions = [
    ...EXTENSIONS.map((ext) => ext + ".src"),
    ...EXTENSIONS,
  ];

  for (const ext of allExtensions) {
    const pathWithExt = basePath + ext;
    try {
      if (await exists(pathWithExt)) return pathWithExt;
    } catch {
      // Continue
    }
  }

  // Try index file
  for (const ext of allExtensions) {
    const indexPath = join(basePath, "index" + ext);
    try {
      if (await exists(indexPath)) return indexPath;
    } catch {
      // Continue
    }
  }

  return null;
}

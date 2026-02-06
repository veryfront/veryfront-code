import { join } from "#veryfront/compat/path";
import { rendererLogger as logger } from "#veryfront/utils";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import {
  DIRECTORY_PREFIXES,
  FRAMEWORK_ROOT,
  LOG_PREFIX_MDX_LOADER,
  MODULE_EXTENSIONS,
} from "../constants.ts";
import { getLocalFs } from "../cache/index.ts";

// Embedded source directory for compiled binaries (created by prepare-framework-sources.ts)
const EMBEDDED_SRC_DIR = join(FRAMEWORK_ROOT, "dist", "framework-src");

// Log framework paths on first load for debugging
logger.debug("[file-finder] Module loaded with framework paths", {
  FRAMEWORK_ROOT,
  EMBEDDED_SRC_DIR,
});

// Extensions to try for framework files (includes .src for compiled binary embedded sources)
const FRAMEWORK_EXTENSIONS = [
  ".tsx.src",
  ".ts.src",
  ".jsx.src",
  ".js.src", // Embedded sources for compiled binaries
  ".tsx",
  ".ts",
  ".jsx",
  ".js", // Regular sources for dev mode
];

// Framework lookup directories in priority order
const FRAMEWORK_LOOKUP_DIRS = [
  EMBEDDED_SRC_DIR, // Embedded sources for compiled binaries (.src files)
  join(FRAMEWORK_ROOT, "src"), // Regular sources for dev mode
];

export interface FileResolutionResult {
  sourceCode: string;
  actualFilePath: string;
}

function decodeContent(content: string | Uint8Array): string {
  return typeof content === "string" ? content : new TextDecoder().decode(content);
}

async function tryReadFile(
  path: string,
  readFile: (path: string) => Promise<string | Uint8Array>,
): Promise<FileResolutionResult | null> {
  try {
    const content = await readFile(path);
    return { sourceCode: decodeContent(content), actualFilePath: path };
  } catch {
    return null;
  }
}

function stripTrailingSlashes(path: string): string {
  return path.replace(/\/+$/, "");
}

/** Framework modules are only resolved via the internal _veryfront/ prefix. */
const FRAMEWORK_PREFIX = "_veryfront/";

export async function resolveModuleFile(
  normalizedPath: string,
  adapter: RuntimeAdapter,
  projectDir?: string,
): Promise<FileResolutionResult | null> {
  const normalized = normalizedPath.replace(/^\/+/, "");
  const withoutVfModules = normalized.replace(/^_vf_modules\//, "");
  const isFramework = withoutVfModules.startsWith(FRAMEWORK_PREFIX);
  const rawPath = isFramework ? withoutVfModules.slice(FRAMEWORK_PREFIX.length) : withoutVfModules;
  const filePathWithoutJs = rawPath.replace(/\?.*$/, "").replace(/\.js$/, "");

  const hasKnownExt = MODULE_EXTENSIONS.some((ext) => filePathWithoutJs.endsWith(ext));
  const filePathWithoutExt = hasKnownExt
    ? filePathWithoutJs.replace(/\.(tsx|ts|jsx|js|mdx)$/, "")
    : filePathWithoutJs;

  if (!isFramework && adapter.fs.resolveFile) {
    for (const prefix of DIRECTORY_PREFIXES) {
      const basePath = prefix + filePathWithoutExt;
      const resolvedPath = await adapter.fs.resolveFile(basePath);
      if (!resolvedPath) continue;

      try {
        const content = await adapter.fs.readFile(resolvedPath);
        logger.debug(`${LOG_PREFIX_MDX_LOADER} Found file via index`, {
          normalizedPath,
          basePath,
          resolvedPath,
        });
        return { sourceCode: decodeContent(content), actualFilePath: resolvedPath };
      } catch (error) {
        logger.warn(`${LOG_PREFIX_MDX_LOADER} Failed to read resolved file`, {
          resolvedPath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    logger.debug(`${LOG_PREFIX_MDX_LOADER} Extension resolution failed via index`, {
      normalizedPath,
      filePathWithoutExt,
    });
  }

  if (!isFramework && projectDir && !adapter.fs.resolveFile) {
    const localFs = getLocalFs();
    const normalizedProjectDir = stripTrailingSlashes(projectDir);

    for (const prefix of DIRECTORY_PREFIXES) {
      if (hasKnownExt) {
        const absolutePath = join(normalizedProjectDir, prefix + filePathWithoutJs);
        const result = await tryReadFile(absolutePath, (p) => localFs.readTextFile(p));
        if (result) return result;
      }

      for (const ext of MODULE_EXTENSIONS) {
        const absolutePath = join(normalizedProjectDir, prefix + filePathWithoutExt + ext);
        const result = await tryReadFile(absolutePath, (p) => localFs.readTextFile(p));
        if (result) return result;
      }

      for (const ext of MODULE_EXTENSIONS) {
        const absolutePath = join(normalizedProjectDir, prefix, filePathWithoutExt, `index${ext}`);
        const result = await tryReadFile(absolutePath, (p) => localFs.readTextFile(p));
        if (result) return result;
      }
    }

    logger.debug(`${LOG_PREFIX_MDX_LOADER} Extension resolution failed (no resolveFile)`, {
      normalizedPath,
      filePathWithoutExt,
      projectDir: normalizedProjectDir,
    });
  }

  if (!isFramework) return null;

  // Try to resolve framework files from multiple locations:
  // 1. EMBEDDED_SRC_DIR (dist/framework-src) - for compiled binaries with .src extensions
  // 2. FRAMEWORK_ROOT/src - for development mode with regular extensions
  const localFs = getLocalFs();

  logger.debug(`${LOG_PREFIX_MDX_LOADER} Resolving framework file`, {
    normalizedPath,
    filePathWithoutJs,
    FRAMEWORK_ROOT,
    EMBEDDED_SRC_DIR,
    lookupDirs: FRAMEWORK_LOOKUP_DIRS,
  });

  for (const lookupDir of FRAMEWORK_LOOKUP_DIRS) {
    for (const ext of FRAMEWORK_EXTENSIONS) {
      const frameworkPath = join(lookupDir, filePathWithoutJs + ext);

      try {
        const stat = await localFs.stat(frameworkPath);
        if (!stat?.isFile) continue;

        const content = await localFs.readTextFile(frameworkPath);
        logger.debug(`${LOG_PREFIX_MDX_LOADER} Found framework file`, {
          basePath: filePathWithoutJs,
          resolvedPath: frameworkPath,
          lookupDir,
        });
        return { sourceCode: content, actualFilePath: frameworkPath };
      } catch {
        // Continue trying other extensions/directories
      }
    }
  }

  logger.debug(`${LOG_PREFIX_MDX_LOADER} Framework file not found`, {
    filePathWithoutJs,
    triedDirs: FRAMEWORK_LOOKUP_DIRS,
    triedExtensions: FRAMEWORK_EXTENSIONS,
  });

  return null;
}

export async function resolveFileWithExtension(
  relativePath: string,
  readFile: (path: string) => Promise<string | null>,
): Promise<{ content: string; resolvedPath: string; extension: string } | null> {
  const extensions = ["", ".tsx", ".ts", ".jsx", ".js", ".mdx"];

  for (const tryExt of extensions) {
    const tryPath = relativePath + tryExt;
    const content = await readFile(tryPath);
    if (content === null) continue;

    const extension = tryExt || tryPath.split(".").pop() || "";
    return { content, resolvedPath: tryPath, extension };
  }

  for (const tryExt of [".tsx", ".ts", ".jsx", ".js", ".mdx"]) {
    const tryPath = `${relativePath}/index${tryExt}`;
    const content = await readFile(tryPath);
    if (content === null) continue;

    return { content, resolvedPath: tryPath, extension: tryExt };
  }

  return null;
}

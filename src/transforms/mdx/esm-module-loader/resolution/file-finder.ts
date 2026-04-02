import { join } from "#veryfront/compat/path";
import { rendererLogger } from "#veryfront/utils";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import {
  FRAMEWORK_EMBEDDED_SRC_DIR,
  FRAMEWORK_ROOT,
  resolveFrameworkSourcePath,
} from "#veryfront/platform/compat/framework-source-resolver.ts";
import { DIRECTORY_PREFIXES, LOG_PREFIX_MDX_LOADER, MODULE_EXTENSIONS } from "../constants.ts";
import { getLocalFs } from "../cache/index.ts";

const logger = rendererLogger.component("file-finder");

// Log framework paths on first load for debugging
logger.debug("Module loaded with framework paths", {
  FRAMEWORK_ROOT,
  EMBEDDED_SRC_DIR: FRAMEWORK_EMBEDDED_SRC_DIR,
});

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
  } catch (_) {
    /* expected: file may not exist at this path */
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
  // 1. FRAMEWORK_ROOT/src - source checkouts should prefer current source files
  // 2. EMBEDDED_SRC_DIR (dist/framework-src) - fallback for compiled binaries
  const localFs = getLocalFs();

  logger.debug(`${LOG_PREFIX_MDX_LOADER} Resolving framework file`, {
    normalizedPath,
    filePathWithoutJs,
    FRAMEWORK_ROOT,
    EMBEDDED_SRC_DIR: FRAMEWORK_EMBEDDED_SRC_DIR,
  });

  const resolvedFrameworkPath = await resolveFrameworkSourcePath(filePathWithoutJs, {
    fileSystem: localFs,
    extensions: [".tsx.src", ".ts.src", ".jsx.src", ".js.src", ".tsx", ".ts", ".jsx", ".js"],
    includeIndexFallback: false,
  });
  if (resolvedFrameworkPath) {
    const content = await localFs.readTextFile(resolvedFrameworkPath.path);
    logger.debug(`${LOG_PREFIX_MDX_LOADER} Found framework file`, {
      basePath: filePathWithoutJs,
      resolvedPath: resolvedFrameworkPath.path,
      lookupDir: resolvedFrameworkPath.lookupDir,
    });
    return { sourceCode: content, actualFilePath: resolvedFrameworkPath.path };
  }

  logger.debug(`${LOG_PREFIX_MDX_LOADER} Framework file not found`, {
    filePathWithoutJs,
    triedDirs: [join(FRAMEWORK_ROOT, "src"), FRAMEWORK_EMBEDDED_SRC_DIR],
    triedExtensions: [".tsx.src", ".ts.src", ".jsx.src", ".js.src", ".tsx", ".ts", ".jsx", ".js"],
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

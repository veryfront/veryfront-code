import { join } from "#std/path.ts";
import { rendererLogger as logger } from "#veryfront/utils";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import {
  DIRECTORY_PREFIXES,
  FRAMEWORK_ROOT,
  LOG_PREFIX_MDX_LOADER,
  MODULE_EXTENSIONS,
} from "../constants.ts";
import { getLocalFs } from "../cache/index.ts";

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

/** Prefixes that indicate a framework-internal module (resolved locally, not via API).
 * Note: "lib/" is intentionally excluded — user projects commonly have lib/ files
 * (e.g. lib/utils.ts from shadcn). Project files are resolved first via the API adapter,
 * with framework lib/ files (Head, Router, etc.) as a fallback in the framework lookup below. */
const FRAMEWORK_PREFIXES = ["src/exports/", "exports/", "react/"];

function isFrameworkPath(filePathWithoutJs: string): boolean {
  return FRAMEWORK_PREFIXES.some((prefix) => filePathWithoutJs.startsWith(prefix));
}

export async function resolveModuleFile(
  normalizedPath: string,
  adapter: RuntimeAdapter,
  projectDir?: string,
): Promise<FileResolutionResult | null> {
  const filePathWithoutJs = normalizedPath
    .replace(/^_vf_modules\//, "")
    .replace(/^_veryfront\//, "")
    .replace(/\?.*$/, "")
    .replace(/\.js$/, "");

  const hasKnownExt = MODULE_EXTENSIONS.some((ext) => filePathWithoutJs.endsWith(ext));
  const filePathWithoutExt = hasKnownExt
    ? filePathWithoutJs.replace(/\.(tsx|ts|jsx|js|mdx)$/, "")
    : filePathWithoutJs;

  const isFramework = isFrameworkPath(filePathWithoutJs);

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

  const frameworkLookups: Array<[prefix: string, frameworkDir: string]> = [
    ["lib/", join(FRAMEWORK_ROOT, "src")],
    ["src/exports/", FRAMEWORK_ROOT],
    ["exports/", join(FRAMEWORK_ROOT, "src")],
    ["react/", join(FRAMEWORK_ROOT, "src")],
  ];

  const localFs = getLocalFs();
  for (const [prefix, frameworkDir] of frameworkLookups) {
    if (!filePathWithoutJs.startsWith(prefix)) continue;

    for (const ext of MODULE_EXTENSIONS) {
      const frameworkPath = join(frameworkDir, filePathWithoutJs + ext);

      try {
        const stat = await localFs.stat(frameworkPath);
        if (!stat?.isFile) continue;

        const content = await localFs.readTextFile(frameworkPath);
        logger.debug(`${LOG_PREFIX_MDX_LOADER} Found framework file`, {
          prefix,
          basePath: filePathWithoutJs,
          resolvedPath: frameworkPath,
        });
        return { sourceCode: content, actualFilePath: frameworkPath };
      } catch {
        // Continue trying other extensions
      }
    }
  }

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

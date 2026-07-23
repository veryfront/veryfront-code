/**
 * File Resolver
 *
 * Utilities for finding source files and local lib files.
 *
 * @module rendering/orchestrator/file-resolver
 */

import { fromFileUrl, isAbsolute, join, relative } from "#veryfront/compat/path";
import { rendererLogger as logger } from "#veryfront/utils";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { buildCandidatePaths, findFirstExisting } from "./candidates.ts";

export { buildCandidatePaths, findFirstExisting } from "./candidates.ts";

const SOURCE_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".mdx", ".md"];
const COMPONENT_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js"];

export function getLocalLibDir(): string {
  const currentFile = fromFileUrl(import.meta.url);
  const srcIndex = currentFile.indexOf("/src/");
  if (srcIndex !== -1) return `${currentFile.substring(0, srcIndex)}/src/lib`;

  return currentFile.replace(
    /\/src\/rendering\/orchestrator\/file-resolver\/index\.ts$/,
    "/src/lib",
  );
}

export async function findLocalLibFile(
  relativePath: string,
  localAdapter: RuntimeAdapter,
): Promise<string | null> {
  validateRelativeSourcePath(relativePath);
  const libDir = getLocalLibDir();
  const fileName = relativePath.replace(/^lib\//, "");
  const candidates = buildCandidatePaths(libDir, fileName, COMPONENT_EXTENSIONS);

  const result = await findFirstExisting(
    candidates,
    (path) => assertSafeSourceFile(path, libDir, localAdapter),
  );
  logger.debug(result ? "Local library source found" : "Local library source not found");

  return result;
}

export async function findSourceFile(
  basePath: string,
  projectDir: string,
  adapter: RuntimeAdapter,
): Promise<string | null> {
  validateRelativeSourcePath(basePath);

  if (adapter.fs.resolveFile) {
    const directBases = [join(projectDir, basePath)];
    const withoutComponents = basePath.replace(/^components\//, "");
    if (withoutComponents !== basePath) {
      directBases.push(join(projectDir, withoutComponents));
    }

    for (const candidateBase of directBases) {
      const resolved = await adapter.fs.resolveFile(candidateBase, {
        allowPagesPrefix: false,
      });
      if (resolved) {
        if (!isPathWithin(projectDir, resolved)) {
          throw new TypeError("Resolved source file is outside the project");
        }
        await assertSafeSourceFile(resolved, projectDir, adapter);
        logger.debug("Source file found via runtime resolver");
        return resolved;
      }
    }
  }

  const candidates = buildCandidatePaths(projectDir, basePath, SOURCE_EXTENSIONS);

  const withoutComponents = basePath.replace(/^components\//, "");
  if (withoutComponents !== basePath) {
    candidates.push(...buildCandidatePaths(projectDir, withoutComponents, SOURCE_EXTENSIONS));
  }

  const result = await findFirstExisting(
    candidates,
    (path) => assertSafeSourceFile(path, projectDir, adapter),
  );
  logger.debug(result ? "Source file found" : "Source file not found");

  return result;
}

function validateRelativeSourcePath(path: string): void {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//, "");
  if (
    !normalized || isAbsolute(normalized) ||
    normalized.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new TypeError("Source path must be a normalized project-relative path");
  }
  for (const character of normalized) {
    const code = character.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) {
      throw new TypeError("Source path must be a normalized project-relative path");
    }
  }
}

async function assertSafeSourceFile(
  path: string,
  root: string,
  adapter: RuntimeAdapter,
): Promise<void> {
  if (!isPathWithin(root, path)) {
    throw new TypeError("Resolved source file is outside the project");
  }

  if (adapter.fs.lstat && (await adapter.fs.lstat(path)).isSymlink) {
    throw new TypeError("Resolved source file cannot be a symbolic link");
  }

  const info = await adapter.fs.stat(path);
  if (!info.isFile) {
    throw Object.assign(new Error("Source candidate is not a file"), { code: "ENOENT" });
  }

  if (!adapter.fs.realPath) return;
  const [canonicalPath, canonicalRoot] = await Promise.all([
    adapter.fs.realPath(path),
    adapter.fs.realPath(root),
  ]);
  if (!isPathWithin(canonicalRoot, canonicalPath)) {
    throw new TypeError("Resolved source file is outside the project");
  }
}

function isPathWithin(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate).replaceAll("\\", "/");
  return relativePath === "" ||
    (!isAbsolute(relativePath) && relativePath !== ".." && !relativePath.startsWith("../"));
}

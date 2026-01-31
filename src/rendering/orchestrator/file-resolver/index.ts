/**
 * File Resolver
 *
 * Utilities for finding source files and local lib files.
 *
 * @module rendering/orchestrator/file-resolver
 */

import { rendererLogger as logger } from "#veryfront/utils";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { buildCandidatePaths, findFirstExisting } from "./candidates.ts";

export { buildCandidatePaths, findFirstExisting } from "./candidates.ts";

const SOURCE_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".mdx", ".md"];
const COMPONENT_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js"];

export function getLocalLibDir(): string {
  const currentFile = new URL(import.meta.url).pathname;
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
  const libDir = getLocalLibDir();
  const fileName = relativePath.replace(/^lib\//, "");
  const candidates = buildCandidatePaths(libDir, fileName, COMPONENT_EXTENSIONS);

  const result = await findFirstExisting(candidates, (p) => localAdapter.fs.stat(p));
  logger.debug(
    result ? "[FileResolver] Found local lib file:" : "[FileResolver] Local lib file not found:",
    result ?? relativePath,
  );

  return result;
}

export async function findSourceFile(
  basePath: string,
  projectDir: string,
  adapter: RuntimeAdapter,
): Promise<string | null> {
  const candidates = buildCandidatePaths(projectDir, basePath, SOURCE_EXTENSIONS);

  const withoutComponents = basePath.replace(/^components\//, "");
  if (withoutComponents !== basePath) {
    candidates.push(...buildCandidatePaths(projectDir, withoutComponents, SOURCE_EXTENSIONS));
  }

  const result = await findFirstExisting(candidates, (p) => adapter.fs.stat(p));
  logger.debug(
    result ? "[FileResolver] Found file:" : "[FileResolver] File not found:",
    result ?? basePath,
  );

  return result;
}

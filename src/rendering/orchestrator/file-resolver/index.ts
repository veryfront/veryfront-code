/**
 * File Resolver
 *
 * Utilities for finding source files and local lib files.
 *
 * @module rendering/orchestrator/file-resolver
 */

import { join } from "#veryfront/compat/path";
import { rendererLogger as logger } from "#veryfront/utils";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { buildCandidatePaths, findFirstExisting } from "./candidates.ts";

export { buildCandidatePaths, findFirstExisting } from "./candidates.ts";

const SOURCE_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".mdx", ".md"];
const COMPONENT_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js"];

function stripSourceExtension(path: string): { stem: string; hasExt: boolean } {
  const matched = SOURCE_EXTENSIONS.find((ext) => path.endsWith(ext));
  return matched
    ? { stem: path.slice(0, -matched.length), hasExt: true }
    : { stem: path, hasExt: false };
}

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
  // When the specifier already carries an explicit source extension
  // (e.g. `@/components/Welcome.tsx`), the literal on-disk path must be a
  // candidate. `buildCandidatePaths` only produces `${fileName}${ext}` and
  // `${fileName}/index${ext}` variants, so without stripping the extension
  // here the file would never match.
  const { stem, hasExt: hasExplicitExt } = stripSourceExtension(basePath);

  if (adapter.fs.resolveFile) {
    const directBases: string[] = [];
    if (hasExplicitExt) directBases.push(join(projectDir, basePath));
    directBases.push(join(projectDir, stem));

    const stemWithoutComponents = stem.replace(/^components\//, "");
    if (stemWithoutComponents !== stem) {
      if (hasExplicitExt) {
        directBases.push(join(projectDir, basePath.replace(/^components\//, "")));
      }
      directBases.push(join(projectDir, stemWithoutComponents));
    }

    for (const candidateBase of directBases) {
      const resolved = await adapter.fs.resolveFile(candidateBase, {
        allowPagesPrefix: false,
      });
      if (resolved) {
        logger.debug("[FileResolver] Found file via resolveFile:", resolved);
        return resolved;
      }
    }
  }

  const candidates: string[] = [];
  if (hasExplicitExt) candidates.push(join(projectDir, basePath));
  candidates.push(...buildCandidatePaths(projectDir, stem, SOURCE_EXTENSIONS));

  const stemWithoutComponents = stem.replace(/^components\//, "");
  if (stemWithoutComponents !== stem) {
    if (hasExplicitExt) {
      candidates.push(join(projectDir, basePath.replace(/^components\//, "")));
    }
    candidates.push(...buildCandidatePaths(projectDir, stemWithoutComponents, SOURCE_EXTENSIONS));
  }

  const result = await findFirstExisting(candidates, (p) => adapter.fs.stat(p));
  logger.debug(
    result ? "[FileResolver] Found file:" : "[FileResolver] File not found:",
    result ?? basePath,
  );

  return result;
}

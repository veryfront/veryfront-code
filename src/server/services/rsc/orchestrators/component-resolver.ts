import { createFileSystem, realPath } from "#veryfront/platform/compat/fs.ts";
import * as pathHelper from "#veryfront/compat/path";
import type { FileSystemAdapter } from "#veryfront/platform/adapters/base.ts";
import { isWithinDirectory } from "#veryfront/security/path-validation.ts";

const fs = createFileSystem();

const PAGE_EXTENSIONS = ["mdx", "md", "tsx", "ts", "jsx", "js"] as const;

export async function resolveComponentPath(
  pathname: string,
  projectDir: string,
  fsAdapter?: FileSystemAdapter,
  appDir: string = "app",
): Promise<string | null> {
  const cleanPath = cleanPathname(pathname);
  const normalizedAppDir = appDir.replace(/^\/+|\/+$/g, "") || "app";
  const rootPatterns = PAGE_EXTENSIONS.map((extension) => `${normalizedAppDir}/page.${extension}`);

  if (cleanPath === "index") {
    const rootMatch = await findFirstExistingPath(projectDir, rootPatterns, fsAdapter);
    if (rootMatch) return rootMatch;
  }

  const patterns = [
    ...PAGE_EXTENSIONS.map((extension) => `${normalizedAppDir}/${cleanPath}/page.${extension}`),
    ...PAGE_EXTENSIONS.map((extension) => `${normalizedAppDir}/${cleanPath}.${extension}`),
  ];
  return findFirstExistingPath(projectDir, patterns, fsAdapter);
}

function cleanPathname(pathname: string): string {
  const cleaned = pathname.replace(/^\//, "").replace(/^_veryfront\/rsc\/render\//, "");
  return cleaned || "index";
}

async function findFirstExistingPath(
  projectDir: string,
  patterns: string[],
  fsAdapter?: FileSystemAdapter,
): Promise<string | null> {
  const projectRoot = pathHelper.resolve(projectDir);
  for (const pattern of patterns) {
    const fullPath = pathHelper.resolve(projectDir, pattern);
    if (!isWithinDirectory(projectRoot, fullPath)) continue;
    if (!await isCanonicalCandidateContained(projectRoot, fullPath, fsAdapter)) continue;
    if (await fileExists(fullPath, fsAdapter)) return fullPath;
  }
  return null;
}

/**
 * Confirm a lexically contained candidate stays inside the project once
 * symlinks are resolved. Adapters that declare `symlinkSemantics: "none"` or
 * omit `realPath` are virtual/symlink-free by the FileSystemAdapter contract
 * (native/local adapters must provide `realPath`), so the caller's lexical
 * containment check is sufficient for them.
 */
async function isCanonicalCandidateContained(
  projectRoot: string,
  candidate: string,
  fsAdapter?: FileSystemAdapter,
): Promise<boolean> {
  const semantics = fsAdapter
    ? Object.getOwnPropertyDescriptor(fsAdapter, "symlinkSemantics")
    : undefined;
  if (semantics && "value" in semantics && semantics.value === "none") return true;

  const canonicalize = fsAdapter ? fsAdapter.realPath?.bind(fsAdapter) : realPath;
  if (!canonicalize) return true;
  try {
    const [canonicalRoot, canonicalCandidate] = await Promise.all([
      canonicalize(projectRoot),
      canonicalize(candidate),
    ]);
    return isWithinDirectory(canonicalRoot, canonicalCandidate);
  } catch {
    return false;
  }
}

async function fileExists(filePath: string, fsAdapter?: FileSystemAdapter): Promise<boolean> {
  try {
    const stat = fsAdapter ? await fsAdapter.stat(filePath) : await fs.stat(filePath);
    return stat.isFile;
  } catch (_) {
    /* expected: file may not exist */
    return false;
  }
}

export function extractParams(_pathname: string): Record<string, string> {
  return {};
}

import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import * as pathHelper from "#veryfront/compat/path";
import type { FileSystemAdapter } from "#veryfront/platform/adapters/base.ts";

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
  for (const pattern of patterns) {
    const fullPath = pathHelper.join(projectDir, pattern);
    if (await fileExists(fullPath, fsAdapter)) return fullPath;
  }
  return null;
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

import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import * as pathHelper from "#veryfront/compat/path";
import type { FileSystemAdapter } from "#veryfront/platform/adapters/base.ts";

const fs = createFileSystem();

const FILE_PATTERNS = [
  "app/{path}/page.mdx",
  "app/{path}/page.md",
  "app/{path}/page.tsx",
  "app/{path}/page.ts",
  "app/{path}/page.jsx",
  "app/{path}/page.js",
  "app/{path}.mdx",
  "app/{path}.md",
  "app/{path}.tsx",
  "app/{path}.ts",
  "app/{path}.jsx",
  "app/{path}.js",
];

const ROOT_PATTERNS = [
  "app/page.mdx",
  "app/page.md",
  "app/page.tsx",
  "app/page.ts",
  "app/page.jsx",
  "app/page.js",
];

export async function resolveComponentPath(
  pathname: string,
  projectDir: string,
  fsAdapter?: FileSystemAdapter,
): Promise<string | null> {
  const cleanPath = cleanPathname(pathname);

  if (cleanPath === "index") {
    const rootMatch = await findFirstExistingPath(projectDir, ROOT_PATTERNS, fsAdapter);
    if (rootMatch) return rootMatch;
  }

  const patterns = FILE_PATTERNS.map((pattern) => pattern.replace("{path}", cleanPath));
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

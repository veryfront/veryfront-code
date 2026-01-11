import { createFileSystem } from "@veryfront/platform/compat/fs.ts";
import * as pathHelper from "@veryfront/platform/compat/path-helper.ts";
import type { FileSystemAdapter } from "@veryfront/platform/adapters/base.ts";

const fs = createFileSystem();

const FILE_PATTERNS = [
  "app/{path}/page.tsx",
  "app/{path}/page.ts",
  "app/{path}/page.jsx",
  "app/{path}/page.js",
  "app/{path}.tsx",
  "app/{path}.ts",
  "app/{path}.jsx",
  "app/{path}.js",
];

const ROOT_PATTERNS = [
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

  // Check root patterns first if this is the root/index
  if (cleanPath === "index" || cleanPath === "") {
    for (const pattern of ROOT_PATTERNS) {
      const fullPath = pathHelper.join(projectDir, pattern);
      if (await fileExists(fullPath, fsAdapter)) {
        return fullPath;
      }
    }
  }

  // Then check regular patterns
  for (const pattern of FILE_PATTERNS) {
    const fullPath = pathHelper.join(projectDir, pattern.replace("{path}", cleanPath));
    if (await fileExists(fullPath, fsAdapter)) {
      return fullPath;
    }
  }

  return null;
}

function cleanPathname(pathname: string): string {
  const cleaned = pathname.replace(/^\//, "").replace(/^_veryfront\/rsc\/render\//, "");
  return cleaned || "index";
}

async function fileExists(path: string, fsAdapter?: FileSystemAdapter): Promise<boolean> {
  try {
    if (fsAdapter) {
      const stat = await fsAdapter.stat(path);
      return stat.isFile;
    }
    const stat = await fs.stat(path);
    return stat.isFile;
  } catch {
    return false;
  }
}

export function extractParams(_pathname: string): Record<string, string> {
  return {};
}

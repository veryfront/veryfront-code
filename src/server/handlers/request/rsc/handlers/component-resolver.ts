import { join } from "std/path/mod.ts";

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
): Promise<string | null> {
  const cleanPath = cleanPathname(pathname);

  // Check root patterns first if this is the root/index
  if (cleanPath === "index" || cleanPath === "") {
    for (const pattern of ROOT_PATTERNS) {
      const fullPath = join(projectDir, pattern);
      if (await fileExists(fullPath)) {
        return fullPath;
      }
    }
  }

  // Then check regular patterns
  for (const pattern of FILE_PATTERNS) {
    const fullPath = join(projectDir, pattern.replace("{path}", cleanPath));
    if (await fileExists(fullPath)) {
      return fullPath;
    }
  }

  return null;
}

function cleanPathname(pathname: string): string {
  const cleaned = pathname.replace(/^\//, "").replace(/^_veryfront\/rsc\/render\//, "");
  return cleaned || "index";
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const stat = await Deno.stat(path);
    return stat.isFile;
  } catch {
    return false;
  }
}

export function extractParams(_pathname: string): Record<string, string> {
  return {};
}

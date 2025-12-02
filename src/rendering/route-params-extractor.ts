import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import { extractParams } from "@veryfront/routing/slug-mapper/dynamic-route-matcher.ts";
import { join } from "../platform/compat/path-helper.ts";

export async function extractAppRouteParams(
  projectDir: string,
  slug: string,
  adapter: RuntimeAdapter,
): Promise<Record<string, string | string[]> | null> {
  const segments = slug ? slug.split("/").filter(Boolean) : [];
  let currentDir = join(projectDir, "app");
  const patternParts: string[] = [];

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (!segment) continue;
    const exactPath = join(currentDir, segment);

    try {
      const stat = await adapter.fs.stat(exactPath);
      if (stat.isDirectory) {
        currentDir = exactPath;
        patternParts.push(segment);
        continue;
      }
    } catch {
      // Exact match failed
    }

    let foundDynamic = false;
    let isCatchAll = false;
    try {
      const entries = await adapter.fs.readDir(currentDir);
      for await (const entry of entries) {
        if (entry.isDirectory && isDynamicSegment(entry.name)) {
          currentDir = join(currentDir, entry.name);
          patternParts.push(entry.name);
          foundDynamic = true;
          if (entry.name.startsWith("[...")) {
            isCatchAll = true;
          }
          break;
        }
      }
    } catch {
      // Directory not readable
    }

    if (!foundDynamic) {
      return null;
    }

    if (isCatchAll) {
      break;
    }
  }

  const pattern = patternParts.join("/");
  return extractParams(pattern, slug);
}

export async function extractPagesRouteParams(
  projectDir: string,
  slug: string,
  adapter: RuntimeAdapter,
): Promise<Record<string, string | string[]> | null> {
  const segments = slug ? slug.split("/").filter(Boolean) : [];
  const pagesDir = join(projectDir, "pages");
  const routeExtensions = [".tsx", ".jsx", ".ts", ".js", ".mdx"];
  const patternParts: string[] = [];
  let currentDir = pagesDir;

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (!segment) continue;

    const exactPath = join(currentDir, segment);

    // Try exact match first
    try {
      const stat = await adapter.fs.stat(exactPath);
      if (stat.isDirectory) {
        currentDir = exactPath;
        patternParts.push(segment);
        continue;
      }
    } catch {
      // Not an exact directory match
    }

    // Try to find a dynamic segment file or directory
    let foundDynamic = false;
    try {
      const entries = await adapter.fs.readDir(currentDir);
      for await (const entry of entries) {
        const entryName = entry.name;

        if (isDynamicSegment(entryName)) {
          const isCatchAll = entryName.startsWith("[...");
          const isFile = routeExtensions.some((ext) => entryName.endsWith(ext));

          if (isFile && i === segments.length - 1) {
            // This is the page file
            patternParts.push(entryName.replace(/\.(tsx|jsx|ts|js|mdx)$/, ""));
            foundDynamic = true;
            break;
          } else if (entry.isDirectory) {
            currentDir = join(currentDir, entryName);
            patternParts.push(entryName);
            foundDynamic = true;

            if (isCatchAll) {
              // Catch-all captures remaining segments
              break;
            }
            break;
          }
        }
      }
    } catch {
      // Directory not readable
    }

    if (!foundDynamic) {
      return null;
    }
  }

  const pattern = patternParts.join("/");
  return extractParams(pattern, slug);
}

function isDynamicSegment(name: string): boolean {
  return name.startsWith("[") && name.endsWith("]");
}

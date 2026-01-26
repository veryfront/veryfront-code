import type { RuntimeAdapter } from "../platform/adapters/base.js";
import { extractParams } from "../routing/slug-mapper/dynamic-route-matcher.js";
import { EXTENSION_REGEX, isDynamicSegment } from "../utils/route-path-utils.js";
import { join } from "../platform/compat/path-helper.js";
import { logger, startTimer } from "../utils/index.js";

let fsStatCount = 0;
let fsReadDirCount = 0;

export async function extractAppRouteParams(
  projectDir: string,
  slug: string,
  adapter: RuntimeAdapter,
): Promise<Record<string, string | string[]> | null> {
  fsStatCount = 0;
  fsReadDirCount = 0;
  const stopTotal = startTimer("extractAppRouteParams-total");

  const segments = slug ? slug.split("/").filter(Boolean) : [];
  let currentDir = join(projectDir, "app");
  const patternParts: string[] = [];

  for (const segment of segments) {
    if (!segment) continue;
    const exactPath = join(currentDir, segment);

    try {
      fsStatCount++;
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
      fsReadDirCount++;
      for await (const entry of await adapter.fs.readDir(currentDir)) {
        if (!entry.isDirectory || !isDynamicSegment(entry.name)) continue;

        currentDir = join(currentDir, entry.name);
        patternParts.push(entry.name);
        foundDynamic = true;
        isCatchAll = entry.name.startsWith("[...");
        break;
      }
    } catch {
      // Directory not readable
    }

    if (!foundDynamic) {
      stopTotal();
      logger.debug("[RouteParams] extractAppRouteParams", {
        stat: fsStatCount,
        readDir: fsReadDirCount,
      });
      return null;
    }

    if (isCatchAll) break;
  }

  stopTotal();
  logger.debug("[RouteParams] extractAppRouteParams", {
    stat: fsStatCount,
    readDir: fsReadDirCount,
  });

  return extractParams(patternParts.join("/"), slug);
}

export async function extractPagesRouteParams(
  projectDir: string,
  slug: string,
  adapter: RuntimeAdapter,
): Promise<Record<string, string | string[]> | null> {
  let pagesStatCount = 0;
  let pagesReadDirCount = 0;
  const stopTotal = startTimer("extractPagesRouteParams-total");

  const segments = slug ? slug.split("/").filter(Boolean) : [];
  const routeExtensions = [".tsx", ".jsx", ".ts", ".js", ".mdx", ".md"];
  const patternParts: string[] = [];
  let currentDir = join(projectDir, "pages");

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (!segment) continue;
    const exactPath = join(currentDir, segment);

    try {
      pagesStatCount++;
      const stat = await adapter.fs.stat(exactPath);
      if (stat.isDirectory) {
        currentDir = exactPath;
        patternParts.push(segment);
        continue;
      }
    } catch {
      // Not an exact directory match
    }

    let foundDynamic = false;

    try {
      pagesReadDirCount++;
      for await (const entry of await adapter.fs.readDir(currentDir)) {
        const entryName = entry.name;
        if (!isDynamicSegment(entryName)) continue;

        const isCatchAll = entryName.startsWith("[...");
        const isFile = routeExtensions.some((ext) => entryName.endsWith(ext));

        if (isFile && i === segments.length - 1) {
          patternParts.push(entryName.replace(EXTENSION_REGEX, ""));
          foundDynamic = true;
          break;
        }

        if (entry.isDirectory) {
          currentDir = join(currentDir, entryName);
          patternParts.push(entryName);
          foundDynamic = true;
          break;
        }

        if (isCatchAll) break;
      }
    } catch {
      // Directory not readable
    }

    if (!foundDynamic) {
      stopTotal();
      logger.debug("[RouteParams] extractPagesRouteParams", {
        stat: pagesStatCount,
        readDir: pagesReadDirCount,
      });
      return null;
    }
  }

  stopTotal();
  logger.debug("[RouteParams] extractPagesRouteParams", {
    stat: pagesStatCount,
    readDir: pagesReadDirCount,
  });

  return extractParams(patternParts.join("/"), slug);
}

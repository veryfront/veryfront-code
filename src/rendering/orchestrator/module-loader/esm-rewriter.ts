import { rendererLogger as logger } from "#veryfront/utils";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { generateHash } from "./cache.ts";

type PathResolver = (path: string) => string;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function rewriteEsmPaths(code: string, urlBase: string): string {
  const resolveAbsolute: PathResolver = (path) => `https://esm.sh${path}`;
  const resolveRelative: PathResolver = (path) => new URL(path, urlBase).href;

  const patterns: Array<[RegExp, number, PathResolver]> = [
    [/import\s*(["'])(\/[^"']+)\1/g, 2, resolveAbsolute],
    [/from\s*(["'])(\/[^"']+)\1/g, 2, resolveAbsolute],
    [/export\s*\*\s*from\s*(["'])(\/[^"']+)\1/g, 2, resolveAbsolute],
    [/export\s*\{([^}]+)\}\s*from\s*(["'])(\/[^"']+)\2/g, 3, resolveAbsolute],

    [/import\s*(["'])(\.\.?\/[^"']+)\1/g, 2, resolveRelative],
    [/from\s*(["'])(\.\.?\/[^"']+)\1/g, 2, resolveRelative],
    [/export\s*\*\s*from\s*(["'])(\.\.?\/[^"']+)\1/g, 2, resolveRelative],
    [/export\s*\{([^}]+)\}\s*from\s*(["'])(\.\.?\/[^"']+)\2/g, 3, resolveRelative],
  ];

  let result = code;

  for (const [pattern, pathIndex, resolver] of patterns) {
    result = result.replace(pattern, (...args) => {
      const match = args[0] as string;
      const path = args[pathIndex - 1] as string;
      const quote = (pathIndex === 3 ? args[2] : args[1]) as string;

      const resolved = resolver(path);
      const pathPattern = new RegExp(`${quote}${escapeRegExp(path)}${quote}`);
      return match.replace(pathPattern, `${quote}${resolved}${quote}`);
    });
  }

  return result;
}

export async function fetchEsmModule(
  url: string,
  tmpDir: string,
  localAdapter: RuntimeAdapter,
  esmCache: Map<string, string>,
): Promise<string> {
  const cached = esmCache.get(url);
  if (cached) return cached;

  logger.debug("[ModuleLoader] Fetching esm.sh module:", url);

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);

  let code = await response.text();

  const urlBase = url.substring(0, url.lastIndexOf("/") + 1);
  code = rewriteEsmPaths(code, urlBase);

  const allEsmUrls = new Set<string>();
  const urlPattern = /["'](https:\/\/esm\.sh\/[^"']+)["']/g;

  for (let match = urlPattern.exec(code); match !== null; match = urlPattern.exec(code)) {
    allEsmUrls.add(match[1]!);
  }

  const urlArray = Array.from(allEsmUrls);
  const cachedPaths = await Promise.all(
    urlArray.map((esmUrl) => fetchEsmModule(esmUrl, tmpDir, localAdapter, esmCache)),
  );

  if (urlArray.length) {
    const replacementMap = new Map<string, string>();
    for (let i = 0; i < urlArray.length; i++) {
      replacementMap.set(urlArray[i]!, `file://${cachedPaths[i]}`);
    }

    const combinedPattern = new RegExp(urlArray.map(escapeRegExp).join("|"), "g");
    code = code.replace(combinedPattern, (m) => replacementMap.get(m) ?? m);
  }

  const hash = await generateHash(url);
  const tempFilePath = `${tmpDir}/esm-${hash}.js`;
  await localAdapter.fs.writeFile(tempFilePath, code);

  esmCache.set(url, tempFilePath);
  return tempFilePath;
}

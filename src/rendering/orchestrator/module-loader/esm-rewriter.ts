import { rendererLogger } from "#veryfront/utils";
import { MODULE_NOT_FOUND } from "#veryfront/errors";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { generateHash } from "./cache.ts";
import { parseImports } from "#veryfront/transforms/esm/lexer.ts";

const logger = rendererLogger.component("module-loader");

type PathResolver = (path: string) => string;

function esmArtifactCacheKey(tmpDir: string, url: string): string {
  // The pod-level ESM cache is shared by every renderer. A URL alone is not a
  // usable artifact identity because its file lives inside a project/source
  // specific temporary directory.
  return JSON.stringify([tmpDir, url]);
}

/**
 * Specifiers `code` imports statically, as opposed to through `import(...)` or
 * merely mentioning in a string.
 *
 * A lex failure returns every discovered specifier as static, so an unparseable
 * bundle keeps the pre-graceful-degradation behaviour of failing loudly rather
 * than quietly shipping a remote dependency.
 */
async function staticImportSpecifiers(code: string): Promise<Set<string>> {
  try {
    const imports = await parseImports(code);
    return new Set(
      imports.filter((imp) => imp.d === -1 && imp.n).map((imp) => imp.n as string),
    );
  } catch (error) {
    logger.debug("Could not lex a fetched module; treating its imports as static", {
      error: error instanceof Error ? error.message : String(error),
    });
    return new Set(code.match(/https:\/\/esm\.sh\/[^"']+/g) ?? []);
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function rewriteEsmPaths(code: string, urlBase: string): string {
  // Skip veryfront module paths - they're served locally, not via esm.sh
  const resolveAbsolute: PathResolver = (path) =>
    path.startsWith("/_vf_modules/") || path.startsWith("/_veryfront/")
      ? path
      : `https://esm.sh${path}`;
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
      const match = args[0];
      const path = args[pathIndex - 1];
      const quote = pathIndex === 3 ? args[2] : args[1];

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
  const cacheKey = esmArtifactCacheKey(tmpDir, url);
  const cached = esmCache.get(cacheKey);
  if (cached) {
    try {
      if (await localAdapter.fs.exists(cached)) return cached;
    } catch (error) {
      logger.debug("Could not validate cached esm.sh artifact", {
        url,
        artifactPath: cached,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    // The temporary directory may have been cleaned independently of the
    // process-wide LRU. Never return a path that no longer exists.
    esmCache.delete(cacheKey);
  }

  logger.debug("Fetching esm.sh module:", url);

  const response = await fetch(url);
  if (!response.ok) {
    throw MODULE_NOT_FOUND.create({ detail: `Failed to fetch ${url}: ${response.status}` });
  }

  let code = await response.text();

  const urlBase = url.substring(0, url.lastIndexOf("/") + 1);
  code = rewriteEsmPaths(code, urlBase);

  const allEsmUrls = new Set<string>();
  const urlPattern = /["'](https:\/\/esm\.sh\/[^"']+)["']/g;

  for (let match = urlPattern.exec(code); match; match = urlPattern.exec(code)) {
    if (match[1]) allEsmUrls.add(match[1]);
  }

  const urlArray = Array.from(allEsmUrls);
  const staticUrls = await staticImportSpecifiers(code);
  // Nested pre-fetches of a URL this module only reaches lazily are
  // best-effort: a broken esm.sh build for one package logs a warning and the
  // URL stays in the emitted code for the runtime to resolve at call time. A
  // URL the module imports statically is part of its own import graph and must
  // still resolve here, so the emitted artifact's static dependencies stay
  // local. See `transforms/esm/specifier-resolver.ts` for the same rule on the
  // SSR transform path.
  const settledPaths = await Promise.allSettled(
    urlArray.map((esmUrl) => fetchEsmModule(esmUrl, tmpDir, localAdapter, esmCache)),
  );

  if (urlArray.length) {
    const replacementMap = new Map<string, string>();
    for (let i = 0; i < urlArray.length; i++) {
      const url = urlArray[i];
      const result = settledPaths[i];
      if (!url || !result) continue;
      if (result.status === "fulfilled") {
        replacementMap.set(url, `file://${result.value}`);
        continue;
      }

      // A statically imported dependency must be local before this module is
      // handed to the runtime loader, so its failure stays fatal.
      if (staticUrls.has(url)) throw result.reason;

      logger.warn("Leaving an unfetchable lazy esm.sh module for runtime resolution", {
        url,
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
    }

    if (replacementMap.size) {
      const combinedPattern = new RegExp(
        Array.from(replacementMap.keys()).map(escapeRegExp).join("|"),
        "g",
      );
      code = code.replace(combinedPattern, (m) => replacementMap.get(m) ?? m);
    }
  }

  const hash = await generateHash(url);
  const tempFilePath = `${tmpDir}/esm-${hash}.js`;
  await localAdapter.fs.writeFile(tempFilePath, code);

  esmCache.set(cacheKey, tempFilePath);
  return tempFilePath;
}

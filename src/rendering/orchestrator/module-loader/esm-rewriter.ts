import { rendererLogger } from "#veryfront/utils";
import { MODULE_NOT_FOUND } from "#veryfront/errors";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { generateHash } from "./cache.ts";
import { parseImports, replaceSpecifiers } from "#veryfront/transforms/esm/lexer.ts";

const logger = rendererLogger.component("module-loader");

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

/**
 * Point an esm.sh bundle's server-absolute and relative specifiers at absolute
 * esm.sh URLs, so the module still resolves once it is written to a temp file.
 *
 * The rewrite is driven by the module lexer rather than by pattern matching:
 * only a position the lexer reports as a specifier is edited, so ordinary
 * string data that happens to read like an import statement — say
 * `const help = 'from "/v135/help"'` — is left alone. A bundle the lexer
 * cannot read keeps its specifiers verbatim; guessing with a regex there would
 * reintroduce exactly the string-versus-specifier confusion this avoids.
 */
export async function rewriteEsmPaths(code: string, urlBase: string): Promise<string> {
  try {
    return await replaceSpecifiers(code, (specifier) => {
      if (specifier.startsWith("./") || specifier.startsWith("../")) {
        return new URL(specifier, urlBase).href;
      }
      if (!specifier.startsWith("/")) return null;
      // veryfront module paths are served locally, not via esm.sh.
      if (specifier.startsWith("/_vf_modules/") || specifier.startsWith("/_veryfront/")) {
        return null;
      }
      return `https://esm.sh${specifier}`;
    });
  } catch (error) {
    logger.debug("Could not lex a fetched module; leaving its specifiers unrewritten", {
      error: error instanceof Error ? error.message : String(error),
    });
    return code;
  }
}

/** Where `url`'s rewritten source is written. Depends only on `url` and `tmpDir`. */
async function esmTempFilePath(url: string, tmpDir: string): Promise<string> {
  return `${tmpDir}/esm-${await generateHash(url)}.js`;
}

export async function fetchEsmModule(
  url: string,
  tmpDir: string,
  localAdapter: RuntimeAdapter,
  esmCache: Map<string, string>,
): Promise<string> {
  return await fetchEsmModuleWithin(url, tmpDir, localAdapter, esmCache, new Set());
}

/**
 * @param pending URLs whose fetch is still unwinding further up this call
 * stack. A dependency graph with a cycle would otherwise recurse forever,
 * because a URL only reaches `esmCache` once its own nested fetches finish.
 */
async function fetchEsmModuleWithin(
  url: string,
  tmpDir: string,
  localAdapter: RuntimeAdapter,
  esmCache: Map<string, string>,
  pending: ReadonlySet<string>,
): Promise<string> {
  const cached = esmCache.get(url);
  if (cached) return cached;

  logger.debug("Fetching esm.sh module:", url);

  const response = await fetch(url);
  if (!response.ok) {
    throw MODULE_NOT_FOUND.create({ detail: `Failed to fetch ${url}: ${response.status}` });
  }

  let code = await response.text();

  const urlBase = url.substring(0, url.lastIndexOf("/") + 1);
  code = await rewriteEsmPaths(code, urlBase);

  const allEsmUrls = new Set<string>();
  const urlPattern = /["'](https:\/\/esm\.sh\/[^"']+)["']/g;

  for (let match = urlPattern.exec(code); match; match = urlPattern.exec(code)) {
    if (match[1]) allEsmUrls.add(match[1]);
  }

  const urlArray = Array.from(allEsmUrls);
  const staticUrls = await staticImportSpecifiers(code);
  const tempFilePath = await esmTempFilePath(url, tmpDir);
  const nested = new Set(pending).add(url);
  // Nested pre-fetches of a URL this module only reaches lazily are
  // best-effort: a broken esm.sh build for one package logs a warning and the
  // URL stays in the emitted code for the runtime to resolve at call time. A
  // URL the module imports statically is part of its own import graph and must
  // still resolve here, so the emitted artifact's static dependencies stay
  // local. See `transforms/esm/specifier-resolver.ts` for the same rule on the
  // SSR transform path.
  const settledPaths = await Promise.allSettled(
    urlArray.map((esmUrl) =>
      // A URL already on this stack is mid-fetch, so re-entering it would never
      // terminate. Its temp path is fixed by `esmTempFilePath`, and the frame
      // that owns it writes the file before the top-level fetch resolves, so a
      // cyclic edge can point at that path without being fetched again.
      nested.has(esmUrl)
        ? esmTempFilePath(esmUrl, tmpDir)
        : fetchEsmModuleWithin(esmUrl, tmpDir, localAdapter, esmCache, nested)
    ),
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

  await localAdapter.fs.writeFile(tempFilePath, code);

  esmCache.set(url, tempFilePath);
  return tempFilePath;
}

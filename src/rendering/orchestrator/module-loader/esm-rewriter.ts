import { MODULE_NOT_FOUND } from "#veryfront/errors";
import { isAbsolute, join, normalize, relative, toFileUrl } from "#veryfront/compat/path/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import { parseImports, replaceSpecifiers } from "#veryfront/transforms/esm/lexer.ts";
import {
  findStaticImportFromSpans,
  findStaticSideEffectImportSpans,
  replaceSourceSpans,
} from "#veryfront/transforms/mdx/esm-module-loader/utils/source-spans.ts";
import { generateHash } from "./cache.ts";

const ESM_ORIGIN = "https://esm.sh";
const MAX_ESM_MODULES = 1_000;
const MAX_ESM_DEPTH = 64;
const MAX_ESM_SOURCE_BYTES = 2 * 1024 * 1024;
const MAX_ESM_CACHE_ENTRIES = 1_000;
const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 15_000;

interface FetchGraphState {
  modules: number;
  visiting: Set<string>;
}

/**
 * Rewrite static esm.sh import specifiers without touching comments or string literals.
 * Dynamic imports are handled by the lexer-backed fetch path.
 */
export function rewriteEsmPaths(code: string, urlBase: string): string {
  const base = validateEsmUrl(urlBase);
  const matchRewritableSpecifier = (specifier: string): string | null => {
    const resolved = resolveEsmSpecifier(specifier, base);
    return resolved === null || resolved === specifier ? null : specifier;
  };
  const spans = [
    ...findStaticImportFromSpans(code, matchRewritableSpecifier),
    ...findStaticSideEffectImportSpans(code, matchRewritableSpecifier),
  ];

  return replaceSourceSpans(
    code,
    spans.map((span) => {
      const resolved = resolveEsmSpecifier(span.path, base);
      if (!resolved) throw new TypeError("esm.sh import specifier could not be resolved");
      return {
        start: span.start,
        end: span.end,
        expected: span.original,
        replacement: span.original.replace(span.path, resolved),
      };
    }),
  );
}

export async function fetchEsmModule(
  url: string,
  tmpDir: string,
  localAdapter: RuntimeAdapter,
  esmCache: Map<string, string>,
): Promise<string> {
  await localAdapter.fs.mkdir(tmpDir, { recursive: true });
  const canonicalTmpDir = localAdapter.fs.realPath
    ? await localAdapter.fs.realPath(tmpDir)
    : undefined;

  return await fetchEsmModuleInternal(
    validateEsmUrl(url).href,
    normalize(tmpDir),
    canonicalTmpDir,
    localAdapter,
    esmCache,
    { modules: 0, visiting: new Set() },
    0,
  );
}

async function fetchEsmModuleInternal(
  url: string,
  tmpDir: string,
  canonicalTmpDir: string | undefined,
  localAdapter: RuntimeAdapter,
  esmCache: Map<string, string>,
  state: FetchGraphState,
  depth: number,
): Promise<string> {
  if (depth > MAX_ESM_DEPTH) {
    throw new RangeError(`esm.sh dependency graph exceeds the depth limit of ${MAX_ESM_DEPTH}`);
  }

  const cached = esmCache.get(url);
  if (cached) {
    if (await isValidCachedModule(cached, tmpDir, canonicalTmpDir, localAdapter)) return cached;
    esmCache.delete(url);
  }

  if (state.visiting.has(url)) {
    throw new TypeError("esm.sh dependency graph contains a circular module reference");
  }
  state.modules++;
  if (state.modules > MAX_ESM_MODULES) {
    throw new RangeError(`esm.sh dependency graph exceeds the ${MAX_ESM_MODULES} module limit`);
  }
  state.visiting.add(url);

  try {
    const response = await fetchFollowingSafeRedirects(url);
    if (!response.ok) {
      throw MODULE_NOT_FOUND.create({
        detail: `esm.sh returned HTTP ${response.status} for a module request`,
      });
    }

    let code = await readBoundedResponseText(response);
    const base = validateEsmUrl(response.url || url);
    code = await replaceSpecifiers(code, (specifier) => resolveEsmSpecifier(specifier, base));

    const dependencyUrls = new Set<string>();
    for (const imported of await parseImports(code)) {
      if (!imported.n) continue;
      if (imported.n.startsWith(`${ESM_ORIGIN}/`)) {
        dependencyUrls.add(validateEsmUrl(imported.n).href);
      } else if (/^https?:\/\//i.test(imported.n)) {
        throw new TypeError("esm.sh module imports an unapproved remote origin");
      }
    }
    if (dependencyUrls.size + state.modules > MAX_ESM_MODULES) {
      throw new RangeError(`esm.sh dependency graph exceeds the ${MAX_ESM_MODULES} module limit`);
    }

    const replacements = new Map<string, string>();
    for (const dependencyUrl of [...dependencyUrls].sort()) {
      const cachedPath = await fetchEsmModuleInternal(
        dependencyUrl,
        tmpDir,
        canonicalTmpDir,
        localAdapter,
        esmCache,
        state,
        depth + 1,
      );
      replacements.set(dependencyUrl, toFileUrl(cachedPath).href);
    }
    if (replacements.size > 0) {
      code = await replaceSpecifiers(code, (specifier) => replacements.get(specifier));
    }

    const hash = await generateHash(url);
    const tempFilePath = join(tmpDir, `esm-${hash}.mjs`);
    if (!isPathWithinRoot(tempFilePath, tmpDir)) {
      throw new TypeError("esm.sh cache path must stay inside its cache directory");
    }
    await localAdapter.fs.writeFile(tempFilePath, code);

    while (esmCache.size >= MAX_ESM_CACHE_ENTRIES && !esmCache.has(url)) {
      const oldest = esmCache.keys().next().value;
      if (typeof oldest !== "string") break;
      esmCache.delete(oldest);
    }
    esmCache.set(url, tempFilePath);
    return tempFilePath;
  } finally {
    state.visiting.delete(url);
  }
}

function resolveEsmSpecifier(specifier: string, base: URL): string | null {
  if (specifier.startsWith("/_vf_modules/") || specifier.startsWith("/_veryfront/")) {
    return specifier;
  }
  if (/^https?:\/\//i.test(specifier)) return validateEsmUrl(specifier).href;
  if (specifier.startsWith("/") || specifier.startsWith("./") || specifier.startsWith("../")) {
    return validateEsmUrl(new URL(specifier, base).href).href;
  }
  return null;
}

function validateEsmUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new TypeError("esm.sh module URL is invalid");
  }
  if (
    url.origin !== ESM_ORIGIN || url.protocol !== "https:" || url.username || url.password ||
    url.hash
  ) {
    throw new TypeError("esm.sh module URL must use the approved HTTPS origin");
  }
  return url;
}

async function fetchFollowingSafeRedirects(initialUrl: string): Promise<Response> {
  let url = validateEsmUrl(initialUrl);
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: "application/javascript, text/javascript;q=0.9" },
    });
    if (response.status < 300 || response.status >= 400) return response;

    const location = response.headers.get("location");
    if (!location || redirects === MAX_REDIRECTS) {
      throw MODULE_NOT_FOUND.create({ detail: "esm.sh returned an invalid redirect chain" });
    }
    url = validateEsmUrl(new URL(location, url).href);
  }
  throw MODULE_NOT_FOUND.create({ detail: "esm.sh returned too many redirects" });
}

async function readBoundedResponseText(response: Response): Promise<string> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const size = Number(contentLength);
    if (!Number.isSafeInteger(size) || size < 0 || size > MAX_ESM_SOURCE_BYTES) {
      throw new RangeError("esm.sh module source exceeds the size limit");
    }
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_ESM_SOURCE_BYTES) {
        throw new RangeError("esm.sh module source exceeds the size limit");
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

async function isValidCachedModule(
  path: string,
  tmpDir: string,
  canonicalTmpDir: string | undefined,
  adapter: RuntimeAdapter,
): Promise<boolean> {
  if (!path.endsWith(".mjs") || !isPathWithinRoot(path, tmpDir)) return false;
  try {
    const info = adapter.fs.lstat ? await adapter.fs.lstat(path) : await adapter.fs.stat(path);
    if (!info.isFile || info.isSymlink || info.size > MAX_ESM_SOURCE_BYTES) return false;
    if (adapter.fs.realPath && canonicalTmpDir) {
      const canonicalPath = await adapter.fs.realPath(path);
      if (!isPathWithinRoot(canonicalPath, canonicalTmpDir)) return false;
    }
    return true;
  } catch (error) {
    if (isNotFoundError(error)) return false;
    throw error;
  }
}

function isPathWithinRoot(path: string, root: string): boolean {
  const relativePath = relative(normalize(root), normalize(path));
  return relativePath === "" ||
    (!isAbsolute(relativePath) && relativePath !== ".." && !relativePath.startsWith("../"));
}

/**
 * CSS Module naming and selector rewriting helpers.
 *
 * Provides deterministic class-name scoping that is stable across
 * transform/runtime boundaries and HTML CSS aggregation.
 */

const CSS_MODULE_EXTENSION = ".module.css";

/**
 * Normalize a module key to a stable slash-based format.
 * Removes query/hash suffixes and normalizes duplicate separators.
 */
export function normalizeCssModuleKey(path: string): string {
  const withoutFilePrefix = path.startsWith("file://") ? path.slice("file://".length) : path;
  const withoutQuery = withoutFilePrefix.replace(/[?#].*$/, "");
  const slashed = withoutQuery.replace(/\\/g, "/");
  const urlMatch = slashed.match(/^(https?:\/\/)(.*)$/);
  const urlPrefix = urlMatch?.[1];
  const urlPath = urlMatch?.[2];
  if (urlPrefix !== undefined && urlPath !== undefined) {
    return `${urlPrefix}${urlPath.replace(/\/{2,}/g, "/")}`;
  }

  const collapsed = slashed.replace(/\/{2,}/g, "/");
  if (collapsed.startsWith("/")) return collapsed;
  return `/${collapsed.replace(/^\/+/, "")}`;
}

function dirname(path: string): string {
  const normalized = normalizeCssModuleKey(path);
  const lastSlash = normalized.lastIndexOf("/");
  return lastSlash <= 0 ? "/" : normalized.slice(0, lastSlash);
}

function normalizePathSegments(path: string): string {
  const normalized = normalizeCssModuleKey(path);
  if (normalized.startsWith("http://") || normalized.startsWith("https://")) return normalized;

  const parts = normalized.split("/").filter(Boolean);
  const resolved: string[] = [];

  for (const part of parts) {
    if (part === ".") continue;
    if (part === "..") {
      resolved.pop();
      continue;
    }
    resolved.push(part);
  }

  return `/${resolved.join("/")}`;
}

/**
 * Resolve a CSS import specifier to a deterministic module key.
 * Supports relative imports, @/ aliases, absolute paths, and URLs.
 */
export function resolveCssModuleKey(
  specifier: string,
  importerFilePath: string,
  projectDir: string,
): string {
  if (specifier.startsWith("http://") || specifier.startsWith("https://")) {
    return normalizeCssModuleKey(specifier);
  }

  if (specifier.startsWith("@/")) {
    const aliasPath = specifier.slice(2).replace(/^\/+/, "");
    return normalizePathSegments(`${normalizeCssModuleKey(projectDir)}/${aliasPath}`);
  }

  if (specifier.startsWith("/")) {
    return normalizePathSegments(specifier);
  }

  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    const importerDir = dirname(importerFilePath);
    return normalizePathSegments(`${importerDir}/${specifier}`);
  }

  // Bare specifiers are uncommon for CSS in this system, but keep deterministic behavior.
  return normalizeCssModuleKey(specifier);
}

function hashString(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash) ^ input.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

function sanitizeToken(token: string): string {
  return token.replace(/[^\w-]/g, "_");
}

/**
 * Build deterministic module scope info.
 */
export function getCssModuleScope(moduleKey: string): { base: string; hash: string } {
  const normalized = normalizeCssModuleKey(moduleKey);
  const filename = normalized.split("/").pop() || "module";
  const base = sanitizeToken(
    filename.endsWith(CSS_MODULE_EXTENSION)
      ? filename.slice(0, -CSS_MODULE_EXTENSION.length)
      : filename.replace(/\.css$/, ""),
  ) || "module";
  const hash = hashString(normalized).slice(0, 6);
  return { base, hash };
}

/**
 * Convert a local class name to its scoped CSS Module class.
 */
export function toScopedCssModuleClass(moduleKey: string, localName: string): string {
  const { base, hash } = getCssModuleScope(moduleKey);
  const normalizedLocal = sanitizeToken(localName);
  return `${base}_${normalizedLocal}__${hash}`;
}

const PROTECTED_CSS_SEGMENT_PATTERN =
  /\/\*[\s\S]*?\*\/|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|url\(\s*(?:"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|[^)]*)\)|:global\((?:[^()]|\([^()]*\))*\)/gi;

function maskProtectedCssSegments(
  css: string,
): { masked: string; restore: (input: string) => string } {
  const segments: string[] = [];
  let tokenPrefix = "__VF_CSS_PROTECTED_";
  while (css.includes(tokenPrefix)) tokenPrefix += "_";

  const masked = css.replace(PROTECTED_CSS_SEGMENT_PATTERN, (match) => {
    const token = `${tokenPrefix}${segments.length}__`;
    segments.push(match);
    return token;
  });

  return {
    masked,
    restore: (input: string) => {
      let result = input;
      for (const [i, segment] of segments.entries()) {
        result = result.replaceAll(`${tokenPrefix}${i}__`, segment);
      }
      return result;
    },
  };
}

function rewriteLocalClasses(selector: string, moduleKey: string): string {
  return selector.replace(
    /\.([_a-zA-Z][_a-zA-Z0-9-]*)/g,
    (_match, className: string) => `.${toScopedCssModuleClass(moduleKey, className)}`,
  );
}

function rewriteSelectorPreludes(css: string, moduleKey: string): string {
  let result = "";
  let chunkStart = 0;

  for (let i = 0; i < css.length; i++) {
    const character = css[i];
    if (character === "{") {
      const chunk = css.slice(chunkStart, i);
      const selectorStart = chunk.lastIndexOf(";") + 1;
      result += chunk.slice(0, selectorStart);
      result += rewriteLocalClasses(chunk.slice(selectorStart), moduleKey);
      result += character;
      chunkStart = i + 1;
    } else if (character === "}") {
      result += css.slice(chunkStart, i + 1);
      chunkStart = i + 1;
    }
  }

  return result + css.slice(chunkStart);
}

/**
 * Rewrite `.module.css` selectors to deterministic scoped class names.
 * Keeps `:global(...)` segments untouched.
 */
export function rewriteCssModuleContent(content: string, moduleKey: string): string {
  const { masked, restore } = maskProtectedCssSegments(content);
  const rewritten = rewriteSelectorPreludes(masked, moduleKey);
  return restore(rewritten);
}

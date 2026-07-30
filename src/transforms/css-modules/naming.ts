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
  if (slashed.startsWith("http://") || slashed.startsWith("https://")) return slashed;
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
 * Convert an absolute CSS Module path to its canonical project-relative
 * identity. The project root is deliberately excluded so temporary checkout
 * locations cannot change generated class names.
 */
export function toProjectRelativeCssModuleKey(
  modulePath: string,
  projectDir: string,
): string {
  const normalizedModulePath = normalizePathSegments(modulePath);
  if (
    normalizedModulePath.startsWith("http://") ||
    normalizedModulePath.startsWith("https://")
  ) {
    return normalizedModulePath;
  }

  const normalizedProjectDir = normalizePathSegments(projectDir);
  if (normalizedProjectDir === "/") return normalizedModulePath;
  if (normalizedModulePath === normalizedProjectDir) return "/";

  const projectPrefix = `${normalizedProjectDir}/`;
  if (!normalizedModulePath.startsWith(projectPrefix)) {
    throw new Error("CSS Module path must stay within the project directory");
  }
  return `/${normalizedModulePath.slice(projectPrefix.length)}`;
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
    return toProjectRelativeCssModuleKey(
      normalizePathSegments(`${normalizeCssModuleKey(projectDir)}/${aliasPath}`),
      projectDir,
    );
  }

  if (specifier.startsWith("/")) {
    return normalizePathSegments(specifier);
  }

  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    const importerDir = dirname(importerFilePath);
    return toProjectRelativeCssModuleKey(
      normalizePathSegments(`${importerDir}/${specifier}`),
      projectDir,
    );
  }

  throw new Error("CSS Module imports must use a local path or an explicit URL");
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

function maskGlobalSelectors(css: string): { masked: string; restore: (input: string) => string } {
  const segments: string[] = [];
  const masked = css.replace(/:global\(([^()]*)\)/g, (match) => {
    const token = `__VF_CSS_GLOBAL_${segments.length}__`;
    segments.push(match);
    return token;
  });

  return {
    masked,
    restore: (input: string) => {
      let result = input;
      for (const [i, segment] of segments.entries()) {
        result = result.replaceAll(`__VF_CSS_GLOBAL_${i}__`, segment);
      }
      return result;
    },
  };
}

/**
 * Rewrite `.module.css` selectors to deterministic scoped class names.
 * Keeps `:global(...)` segments untouched.
 */
export function rewriteCssModuleContent(content: string, moduleKey: string): string {
  const { masked, restore } = maskGlobalSelectors(content);
  // After :global() masking, every `.identifier` in the CSS is a local class
  // selector. No lookbehind needed — numeric decimals like `0.5em` won't
  // match because digits aren't in [_a-zA-Z].
  const rewritten = masked.replace(
    /\.([_a-zA-Z][_a-zA-Z0-9-]*)/g,
    (_match, className: string) => {
      return `.${toScopedCssModuleClass(moduleKey, className)}`;
    },
  );
  return restore(rewritten);
}

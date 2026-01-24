/****
 * Shared path utilities for SPA module resolution.
 * Used by component-loader.ts and hydration script templates.
 */

/** Supported source directories for module resolution */
const SOURCE_DIRS = ["pages", "components", "app", "lib", "layouts", "shared", "features"] as const;

/** Supported source file extensions */
const SOURCE_EXTENSIONS = ["tsx", "ts", "jsx", "mdx"] as const;

/** Regex pattern for matching source paths */
const SOURCE_PATH_PATTERN = new RegExp(
  `(${SOURCE_DIRS.join("|")})/(.+)\\.(${SOURCE_EXTENSIONS.join("|")})$`,
);

const KNOWN_EXT_PATTERN = /\.(tsx|ts|jsx|mdx|js|mjs)$/;
const SOURCE_EXT_REPLACE_PATTERN = /\.(tsx|ts|jsx|mdx)$/;

export function getModuleServerUrl(): string {
  const moduleServerUrl = typeof window !== "undefined"
    ? (window as { MODULE_SERVER_URL?: string }).MODULE_SERVER_URL
    : undefined;

  return moduleServerUrl ?? "/_vf_modules";
}

export function pathToModuleUrl(path: string, baseUrl?: string): string {
  const base = baseUrl ?? getModuleServerUrl();

  const absoluteMatch = path.match(new RegExp(`/${SOURCE_PATH_PATTERN.source}`));
  const relativeMatch = absoluteMatch ?? path.match(new RegExp(`^${SOURCE_PATH_PATTERN.source}`));

  if (!relativeMatch) {
    if (KNOWN_EXT_PATTERN.test(path)) {
      return `${base}/${path.replace(SOURCE_EXT_REPLACE_PATTERN, ".js")}`;
    }
    return `${base}/${path}.js`;
  }

  return `${base}/${relativeMatch[1]}/${relativeMatch[2]}.js`;
}

export function getPathToModuleUrlScript(): string {
  return `
    function pathToModuleUrl(path, baseUrl) {
      const base = baseUrl || MODULE_SERVER_URL;
      const pattern = /(pages|components|app|lib|layouts|shared|features)\\/(.+)\\.(tsx|ts|jsx|mdx)$/;

      let match = path.match(new RegExp('/' + pattern.source));
      match = match || path.match(new RegExp('^' + pattern.source));

      if (!match) {
        const hasKnownExt = /\\.(tsx|ts|jsx|mdx|js|mjs)$/.test(path);
        if (hasKnownExt) {
          return base + '/' + path.replace(/\\.(tsx|ts|jsx|mdx)$/, '.js');
        }
        return base + '/' + path + '.js';
      }

      return base + '/' + match[1] + '/' + match[2] + '.js';
    }
  `.trim();
}

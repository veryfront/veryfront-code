/**
 * Shared path utilities for SPA module resolution.
 * Used by component-loader.ts and hydration script templates.
 */

/** Supported source directories for module resolution */
const SOURCE_DIRS = ["pages", "components", "app", "lib", "layouts", "shared", "features"] as const;

/** Supported source file extensions */
const SOURCE_EXTENSIONS = ["tsx", "ts", "jsx", "mdx"] as const;

/** Regex pattern for matching source paths */
const SOURCE_PATH_PATTERN = new RegExp(
  `(${SOURCE_DIRS.join("|")})/(.+)\\.(${SOURCE_EXTENSIONS.join("|")})$`
);

/**
 * Get the module server URL from window or return default.
 */
export function getModuleServerUrl(): string {
  if (typeof window !== "undefined") {
    const win = window as { MODULE_SERVER_URL?: string };
    if (win.MODULE_SERVER_URL) {
      return win.MODULE_SERVER_URL;
    }
  }
  return "/_vf_modules";
}

/**
 * Convert a source file path to a module URL.
 *
 * Handles multiple path formats:
 * - Absolute: /project/dir/pages/foo.tsx -> /_vf_modules/pages/foo.js
 * - Relative: pages/foo.mdx -> /_vf_modules/pages/foo.js
 * - Direct: custom/path.tsx -> /_vf_modules/custom/path.js
 *
 * @param path - Source file path (e.g., "pages/index.tsx")
 * @param baseUrl - Module server base URL (default: getModuleServerUrl())
 * @returns Full module URL
 */
export function pathToModuleUrl(path: string, baseUrl?: string): string {
  const base = baseUrl ?? getModuleServerUrl();

  // Try absolute path format (legacy): /project/dir/pages/foo.tsx
  let match = path.match(new RegExp(`/${SOURCE_PATH_PATTERN.source}`));

  // Try project-relative path format: pages/foo.mdx
  if (!match) {
    match = path.match(new RegExp(`^${SOURCE_PATH_PATTERN.source}`));
  }

  if (!match) {
    // Direct path fallback - just replace extension
    return `${base}/${path.replace(/\.(tsx|ts|jsx|mdx)$/, ".js")}`;
  }

  // match[1] = directory (pages, components, etc.)
  // match[2] = path within directory
  return `${base}/${match[1]}/${match[2]}.js`;
}

/**
 * Generate inline JavaScript for path resolution in hydration templates.
 * This is used in template strings that run in the browser.
 */
export function getPathToModuleUrlScript(): string {
  return `
    function pathToModuleUrl(path, baseUrl) {
      const base = baseUrl || MODULE_SERVER_URL;
      const pattern = /(pages|components|app|lib|layouts|shared|features)\\/(.+)\\.(tsx|ts|jsx|mdx)$/;

      // Try absolute path format
      let match = path.match(new RegExp('/' + pattern.source));

      // Try project-relative path format
      if (!match) {
        match = path.match(new RegExp('^' + pattern.source));
      }

      if (!match) {
        return base + '/' + path.replace(/\\.(tsx|ts|jsx|mdx)$/, '.js');
      }

      return base + '/' + match[1] + '/' + match[2] + '.js';
    }
  `.trim();
}

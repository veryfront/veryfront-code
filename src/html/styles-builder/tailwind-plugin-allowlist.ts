/**
 * Allowlist of Tailwind CSS plugin package names that may be dynamically loaded
 * via `loadPlugin` / `loadModuleFromEsmSh`.
 *
 * Tailwind v4 stylesheets can request plugins through the `@plugin "..."`
 * directive. Without restriction, this turns arbitrary project CSS into a
 * remote-code-execution vector because the loader fetches and imports code
 * from https://esm.sh. Only the packages listed here may be loaded.
 *
 * @module html/styles-builder/tailwind-plugin-allowlist
 */

export const TAILWIND_PLUGIN_ALLOWLIST: ReadonlySet<string> = new Set([
  "@tailwindcss/typography",
  "@tailwindcss/forms",
  "@tailwindcss/aspect-ratio",
  "@tailwindcss/container-queries",
  "tailwindcss-animate",
]);

/**
 * Matches npm package specifiers, optionally scoped and optionally suffixed
 * with an `@version` range. Deliberately restrictive: ASCII only, no path
 * separators, no whitespace, no control characters.
 */
export const PACKAGE_SPEC_RE = /^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*(?:@[\w.+-]+)?$/i;

/**
 * Return the bare package name (without any `@version` suffix) for a spec.
 *
 * Examples:
 *   bareName("pkg")            -> "pkg"
 *   bareName("pkg@1.0.0")      -> "pkg"
 *   bareName("@scope/pkg")     -> "@scope/pkg"
 *   bareName("@scope/pkg@1.0") -> "@scope/pkg"
 */
export function bareName(spec: string): string {
  if (spec.startsWith("@")) {
    const idx = spec.indexOf("@", 1);
    return idx === -1 ? spec : spec.slice(0, idx);
  }
  const idx = spec.indexOf("@");
  return idx === -1 ? spec : spec.slice(0, idx);
}

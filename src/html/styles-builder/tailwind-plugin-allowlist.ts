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

const APPROVED_TAILWIND_PLUGIN_SPECIFIERS = Object.freeze(
  {
    // Bundled into the compiled binary (see src/build/binary-plugin-includes.ts).
    // Must stay in sync with BINARY_TAILWIND_PLUGIN_PACKAGES. This invariant is
    // enforced by tailwind-plugin-allowlist.test.ts.
    "@tailwindcss/typography": "@tailwindcss/typography@0.5.19",
    "@tailwindcss/forms": "@tailwindcss/forms@0.5.11",
    "tailwindcss-animate": "tailwindcss-animate@1.0.7",
    "tailwind-scrollbar-hide": "tailwind-scrollbar-hide@2.0.0",
    "daisyui": "daisyui@5.5.14",
    // Approved but not bundled. These are fetched from esm.sh on first use.
    // Changing a version changes executable code and requires security review.
    "@tailwindcss/aspect-ratio": "@tailwindcss/aspect-ratio@0.4.2",
    "@tailwindcss/container-queries": "@tailwindcss/container-queries@0.1.1",
  } satisfies Readonly<Record<string, string>>,
);

const ALLOWED_TAILWIND_PLUGINS = new Set(
  Object.keys(APPROVED_TAILWIND_PLUGIN_SPECIFIERS),
);

export const TAILWIND_PLUGIN_ALLOWLIST: ReadonlySet<string> = new Proxy(
  ALLOWED_TAILWIND_PLUGINS,
  {
    get(target, property) {
      if (property === "add" || property === "delete" || property === "clear") return undefined;
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  },
) as ReadonlySet<string>;

/**
 * Matches npm package specifiers, optionally scoped and optionally suffixed
 * with an `@version` range. Deliberately restrictive: ASCII only, no path
 * separators, no whitespace, no control characters.
 */
export const PACKAGE_SPEC_RE =
  /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(?:@[a-z0-9][a-z0-9._+-]*)?$/i;

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

/**
 * Resolve a bare or exactly approved plugin specifier to its reviewed,
 * version-pinned package. Returns undefined for unapproved version overrides.
 */
export function resolveApprovedTailwindPluginSpecifier(spec: string): string | undefined {
  const name = bareName(spec);
  const approved = APPROVED_TAILWIND_PLUGIN_SPECIFIERS[
    name as keyof typeof APPROVED_TAILWIND_PLUGIN_SPECIFIERS
  ];
  if (!approved) return undefined;
  return spec === name || spec === approved ? approved : undefined;
}

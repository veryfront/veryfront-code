/** Audited local plugin policy owned by ext-css-tailwind. */

export type TailwindPluginPolicyEntry = Readonly<{
  name: string;
  version: string;
  importSpecifier: string;
  npmSpecifier: string;
}>;

function definePlugin(
  name: string,
  version: string,
): TailwindPluginPolicyEntry {
  return Object.freeze({
    name,
    version,
    importSpecifier: name,
    npmSpecifier: `npm:${name}@${version}`,
  });
}

/**
 * Complete immutable inventory of third-party plugin implementations shipped
 * by this extension. Each entry must have a matching exact import-map target
 * and a static import in `plugin-loader.ts`.
 */
export const TAILWIND_PLUGIN_POLICY = Object.freeze([
  definePlugin("tailwindcss-animate", "1.0.7"),
  definePlugin("@tailwindcss/typography", "0.5.19"),
  definePlugin("@tailwindcss/forms", "0.5.11"),
  definePlugin("tailwind-scrollbar-hide", "2.0.0"),
  definePlugin("daisyui", "5.5.14"),
]);

export const PACKAGE_SPEC_RE = /^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*(?:@[\w.+-]+)?$/;

export function bareName(specifier: string): string {
  if (specifier.startsWith("@")) {
    const index = specifier.indexOf("@", 1);
    return index === -1 ? specifier : specifier.slice(0, index);
  }
  const index = specifier.indexOf("@");
  return index === -1 ? specifier : specifier.slice(0, index);
}

const POLICY_BY_NAME = new Map(
  TAILWIND_PLUGIN_POLICY.map((entry) => [entry.name, entry]),
);

/** Immutable public view of the packages this extension can load. */
export const TAILWIND_PLUGIN_ALLOWLIST = Object.freeze(
  [...POLICY_BY_NAME.keys()].sort(),
);

export function resolveTailwindPluginPolicy(
  specifier: string,
): TailwindPluginPolicyEntry {
  if (!PACKAGE_SPEC_RE.test(specifier)) {
    throw new TypeError(`Invalid Tailwind plugin specifier: ${specifier}`);
  }
  const name = bareName(specifier);
  const policy = POLICY_BY_NAME.get(name);
  if (policy === undefined) {
    throw new TypeError(`Tailwind plugin is not allowlisted: ${name}`);
  }
  const pinnedSpecifier = `${policy.name}@${policy.version}`;
  if (specifier !== name && specifier !== pinnedSpecifier) {
    throw new TypeError(
      `Tailwind plugin ${name} must use the audited version ${pinnedSpecifier}`,
    );
  }
  return policy;
}

/** Stable, complete local-plugin input included in the processor cache identity. */
export const TAILWIND_PLUGIN_POLICY_IDENTITY = JSON.stringify({
  schema: "veryfront.tailwind-plugin-policy.v3",
  resolution: "extension-owned-static-npm-imports",
  plugins: TAILWIND_PLUGIN_POLICY.map((entry) => ({ ...entry })).sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0
  ),
});

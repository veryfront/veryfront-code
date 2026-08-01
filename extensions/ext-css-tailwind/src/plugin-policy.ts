/** Audited local plugin policy owned by ext-css-tailwind. */

export type TailwindPluginPolicyEntry = Readonly<{
  name: string;
  version: string;
  importSpecifier: string;
  npmSpecifier: string;
}>;

const apply = Reflect.apply;
const MapConstructor = Map;
const NativeTypeError = TypeError;
const arrayMap = Array.prototype.map;
const arraySort = Array.prototype.sort;
const freeze = Object.freeze;
const jsonStringify = JSON.stringify;
const mapGet = Map.prototype.get;
const regexpExec = RegExp.prototype.exec;
const stringIndexOf = String.prototype.indexOf;
const stringSlice = String.prototype.slice;
const stringStartsWith = String.prototype.startsWith;

function definePlugin(
  name: string,
  version: string,
): TailwindPluginPolicyEntry {
  return freeze({
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
export const TAILWIND_PLUGIN_POLICY = freeze([
  definePlugin("tailwindcss-animate", "1.0.7"),
  definePlugin("@tailwindcss/typography", "0.5.19"),
  definePlugin("@tailwindcss/forms", "0.5.11"),
  definePlugin("tailwind-scrollbar-hide", "2.0.0"),
  definePlugin("daisyui", "5.5.14"),
]);

export const PACKAGE_SPEC_RE = freeze(
  /^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*(?:@[\w.+-]+)?$/,
);

export function bareName(specifier: string): string {
  if (typeof specifier !== "string") {
    throw new NativeTypeError("Tailwind plugin specifier must be a string");
  }
  if (apply(stringStartsWith, specifier, ["@"])) {
    const index = apply(stringIndexOf, specifier, ["@", 1]) as number;
    return index === -1 ? specifier : apply(stringSlice, specifier, [0, index]) as string;
  }
  const index = apply(stringIndexOf, specifier, ["@"]) as number;
  return index === -1 ? specifier : apply(stringSlice, specifier, [0, index]) as string;
}

const POLICY_BY_NAME = new MapConstructor(
  apply(arrayMap, TAILWIND_PLUGIN_POLICY, [
    (entry: TailwindPluginPolicyEntry) => [entry.name, entry] as const,
  ]) as ReadonlyArray<readonly [string, TailwindPluginPolicyEntry]>,
);

/** Immutable public view of the packages this extension can load. */
const allowlist = apply(arrayMap, TAILWIND_PLUGIN_POLICY, [
  (entry: TailwindPluginPolicyEntry) => entry.name,
]) as string[];
apply(arraySort, allowlist, []);
export const TAILWIND_PLUGIN_ALLOWLIST = freeze(allowlist);

export function resolveTailwindPluginPolicy(
  specifier: string,
): TailwindPluginPolicyEntry {
  if (
    typeof specifier !== "string" ||
    apply(regexpExec, PACKAGE_SPEC_RE, [specifier]) === null
  ) {
    throw new NativeTypeError(`Invalid Tailwind plugin specifier: ${specifier}`);
  }
  const name = bareName(specifier);
  const policy = apply(mapGet, POLICY_BY_NAME, [name]) as
    | TailwindPluginPolicyEntry
    | undefined;
  if (policy === undefined) {
    throw new NativeTypeError(`Tailwind plugin is not allowlisted: ${name}`);
  }
  const pinnedSpecifier = `${policy.name}@${policy.version}`;
  if (specifier !== name && specifier !== pinnedSpecifier) {
    throw new NativeTypeError(
      `Tailwind plugin ${name} must use the audited version ${pinnedSpecifier}`,
    );
  }
  return policy;
}

/** Stable, complete local-plugin input included in the processor cache identity. */
type PluginIdentityEntry = {
  name: string;
  version: string;
  importSpecifier: string;
  npmSpecifier: string;
};

const identityPlugins = apply(arrayMap, TAILWIND_PLUGIN_POLICY, [
  (entry: TailwindPluginPolicyEntry) => ({
    name: entry.name,
    version: entry.version,
    importSpecifier: entry.importSpecifier,
    npmSpecifier: entry.npmSpecifier,
  }),
]) as PluginIdentityEntry[];
apply(arraySort, identityPlugins, [
  (left: PluginIdentityEntry, right: PluginIdentityEntry) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
]);
export const TAILWIND_PLUGIN_POLICY_IDENTITY = apply(jsonStringify, JSON, [{
  schema: "veryfront.tailwind-plugin-policy.v3",
  resolution: "extension-owned-static-npm-imports",
  plugins: identityPlugins,
}]) as string;

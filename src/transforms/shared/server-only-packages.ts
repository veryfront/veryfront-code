/**
 * Bare npm packages that only ever run server-side (Node/Deno) and must never
 * be bundled for the browser via esm.sh.
 *
 * These are database / cache / messaging drivers that pull Node built-ins
 * (net, tls, dns, fs) and cannot produce a working browser bundle. esm.sh
 * either 500s while building them (e.g. `redis` under `external=react`) or
 * returns a bundle whose Node built-ins are stubbed — a client that can never
 * connect. The framework's own adapters import them behind a lazy, guarded
 * `import()` that only runs when the corresponding backend is configured, so
 * the correct treatment is to leave the specifier external and let the runtime
 * resolve it from `node_modules` (Node) or `npm:` (Deno).
 *
 * This list backs Fix A of the cold-cache redis transform issue. It pairs with
 * the defense-in-depth degraded-stub fallback in the SSR framework transform:
 * anything server-only that slips past this list still degrades gracefully
 * instead of aborting the whole framework module graph.
 */
const SERVER_ONLY_PACKAGES: ReadonlySet<string> = new Set([
  "redis",
  "ioredis",
  "pg",
  "pg-native",
  "postgres",
  "mysql",
  "mysql2",
  "mariadb",
  "mongodb",
  "better-sqlite3",
  "sqlite3",
  "tedious",
  "oracledb",
  "cassandra-driver",
]);
const ReflectApply = Reflect.apply;
const SetHas = Set.prototype.has;
const ArrayIncludes = Array.prototype.includes;
const StringSlice = String.prototype.slice;
const StringStartsWith = String.prototype.startsWith;

function setHas<T>(set: ReadonlySet<T>, value: T): boolean {
  return ReflectApply(SetHas, set, [value]) as boolean;
}

function stringSlice(value: string, start: number): string {
  return ReflectApply(StringSlice, value, [start]) as string;
}

function stringStartsWith(value: string, search: string): boolean {
  return ReflectApply(StringStartsWith, value, [search]) as boolean;
}

/**
 * True if a bare package specifier's package name is a known server-only
 * package that must be left external rather than routed through esm.sh.
 *
 * Accepts a `packageName` as produced by `parseBarePackageSpecifier` (which may
 * carry an `npm:` prefix, e.g. `npm:redis`). The `npm:` prefix is stripped
 * before matching so both `redis` and `npm:redis@5.11.0` are recognized.
 */
export function isServerOnlyPackage(
  packageName: string,
  configuredPackages?: readonly string[],
): boolean {
  const bare = stringStartsWith(packageName, "npm:")
    ? stringSlice(packageName, "npm:".length)
    : packageName;
  return setHas(SERVER_ONLY_PACKAGES, bare) ||
    (configuredPackages !== undefined &&
      ReflectApply(ArrayIncludes, configuredPackages, [bare]) as boolean);
}

export { SERVER_ONLY_PACKAGES };

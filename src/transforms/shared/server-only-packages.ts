import { parseBarePackageSpecifier } from "#veryfront/transforms/shared/package-specifier.ts";
import { parseConfiguredExternalEsmShUrl } from "#veryfront/transforms/shared/esm-sh-specifier.ts";

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
const JsonStringify = JSON.stringify;
const SetHas = Set.prototype.has;
const ArrayIncludes = Array.prototype.includes;
const StringCharCodeAt = String.prototype.charCodeAt;
const StringEndsWith = String.prototype.endsWith;
const StringReplaceAll = String.prototype.replaceAll;
const StringSlice = String.prototype.slice;
const StringStartsWith = String.prototype.startsWith;
const HEX_DIGITS = "0123456789abcdef";

function setHas<T>(set: ReadonlySet<T>, value: T): boolean {
  return ReflectApply(SetHas, set, [value]) as boolean;
}

function stringCharCodeAt(value: string, index: number): number {
  return ReflectApply(StringCharCodeAt, value, [index]) as number;
}

function stringSlice(value: string, start: number, end?: number): string {
  return ReflectApply(StringSlice, value, end === undefined ? [start] : [start, end]) as string;
}

function stringEndsWith(value: string, search: string): boolean {
  return ReflectApply(StringEndsWith, value, [search]) as boolean;
}

function stringReplaceAll(value: string, search: string, replacement: string): string {
  return ReflectApply(StringReplaceAll, value, [search, replacement]) as string;
}

function stringStartsWith(value: string, search: string): boolean {
  return ReflectApply(StringStartsWith, value, [search]) as boolean;
}

function unicodeEscape(code: number): string {
  return `\\u${HEX_DIGITS[(code >>> 12) & 15]}${HEX_DIGITS[(code >>> 8) & 15]}${
    HEX_DIGITS[(code >>> 4) & 15]
  }${HEX_DIGITS[code & 15]}`;
}

function quoteDiagnosticValue(value: string): string {
  const quoted = ReflectApply(JsonStringify, JSON, [value]) as string;
  let safe = "";
  for (let index = 0; index < quoted.length; index++) {
    const code = stringCharCodeAt(quoted, index);
    const escape = (code >= 0x7f && code <= 0x9f) || code === 0x200e || code === 0x200f ||
      code === 0x2028 || code === 0x2029 || (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069);
    safe += escape ? unicodeEscape(code) : quoted[index];
  }
  return safe;
}

function sanitizeDiagnosticValue(value: string): string {
  return stringSlice(quoteDiagnosticValue(value), 1, -1);
}

function normalizeDirectory(directory: string): string {
  let normalized = stringReplaceAll(directory, "\\", "/");
  while (stringEndsWith(normalized, "/")) {
    normalized = stringSlice(normalized, 0, -1);
  }
  return normalized;
}

function isAbsoluteModuleIdentity(value: string): boolean {
  if (stringStartsWith(value, "/") || stringStartsWith(value, "file:")) return true;
  if (value.length < 3 || value[1] !== ":" || value[2] !== "/") return false;
  const first = stringCharCodeAt(value, 0);
  return (first >= 65 && first <= 90) || (first >= 97 && first <= 122);
}

function isUriSchemeIdentity(value: string): boolean {
  const first = stringCharCodeAt(value, 0);
  if (!((first >= 65 && first <= 90) || (first >= 97 && first <= 122))) return false;
  if (value.length >= 3 && value[1] === ":" && value[2] === "/") return false;

  for (let index = 1; index < value.length; index++) {
    const character = stringCharCodeAt(value, index);
    if (character === 58) return true;
    const isLetter = (character >= 65 && character <= 90) ||
      (character >= 97 && character <= 122);
    const isDigit = character >= 48 && character <= 57;
    if (!isLetter && !isDigit && character !== 43 && character !== 45 && character !== 46) {
      return false;
    }
  }
  return false;
}

function hasParentPathSegment(value: string): boolean {
  let segmentStart = 0;
  for (let index = 0; index <= value.length; index++) {
    if (index !== value.length && stringCharCodeAt(value, index) !== 47) continue;
    if (
      index - segmentStart === 2 && stringCharCodeAt(value, segmentStart) === 46 &&
      stringCharCodeAt(value, segmentStart + 1) === 46
    ) {
      return true;
    }
    segmentStart = index + 1;
  }
  return false;
}

function getProjectRelativeModuleIdentity(
  sourceModule?: string,
  projectDir?: string,
): string | undefined {
  if (!sourceModule) return undefined;
  const normalizedSource = stringReplaceAll(sourceModule, "\\", "/");
  if (isUriSchemeIdentity(normalizedSource)) return undefined;
  const normalizedProject = projectDir ? normalizeDirectory(projectDir) : "";

  if (normalizedProject) {
    if (normalizedSource === normalizedProject) return ".";
    if (stringStartsWith(normalizedSource, `${normalizedProject}/`)) {
      const relative = stringSlice(normalizedSource, normalizedProject.length + 1);
      return hasParentPathSegment(relative) ? undefined : relative;
    }
  }

  return isAbsoluteModuleIdentity(normalizedSource) || hasParentPathSegment(normalizedSource)
    ? undefined
    : normalizedSource;
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
    isConfiguredServerExternalPackage(bare, configuredPackages);
}

/** True only when the project explicitly declared this package as server-only. */
export function isConfiguredServerExternalPackage(
  packageName: string,
  configuredPackages?: readonly string[],
): boolean {
  if (configuredPackages === undefined) return false;
  const bare = stringStartsWith(packageName, "npm:")
    ? stringSlice(packageName, "npm:".length)
    : packageName;
  return ReflectApply(ArrayIncludes, configuredPackages, [bare]) as boolean;
}

/** Return the configured package root matched by a complete import specifier. */
export interface ConfiguredServerExternalMatch {
  readonly packageName: string;
  readonly runtimeSpecifier: string;
}

/** Classify a configured import and its server-runtime form. */
export function matchConfiguredServerExternalSpecifier(
  specifier: string,
  configuredPackages?: readonly string[],
): ConfiguredServerExternalMatch | undefined {
  if (configuredPackages === undefined || configuredPackages.length === 0) return undefined;
  const esmSh = parseConfiguredExternalEsmShUrl(specifier);
  if (esmSh !== null) {
    if (!isConfiguredServerExternalPackage(esmSh.packageName, configuredPackages)) return undefined;
    return {
      packageName: esmSh.packageName,
      runtimeSpecifier: esmSh.buildArtifact
        ? esmSh.packageName
        : `${esmSh.packageName}${esmSh.subpath}`,
    };
  }
  const hasNpmProtocol = stringStartsWith(specifier, "npm:");
  const candidate = hasNpmProtocol ? stringSlice(specifier, "npm:".length) : specifier;
  const parsed = parseBarePackageSpecifier(candidate);
  if (!parsed || !isConfiguredServerExternalPackage(parsed.packageName, configuredPackages)) {
    return undefined;
  }
  const runtimeSpecifier = hasNpmProtocol || parsed.version !== null
    ? `${parsed.packageName}${parsed.subpath ?? ""}`
    : specifier;
  return { packageName: parsed.packageName, runtimeSpecifier };
}

/** Return the configured package root matched by a complete import specifier. */
export function getConfiguredServerExternalPackage(
  specifier: string,
  configuredPackages?: readonly string[],
): string | undefined {
  return matchConfiguredServerExternalSpecifier(specifier, configuredPackages)?.packageName;
}

/**
 * Return the server-runtime form of a matched configured external import.
 *
 * Installed Node-style packages cannot resolve inline versions or the `npm:`
 * protocol. Deno may retain an `npm:` specifier because its resolver owns the
 * declared version.
 */
export function getConfiguredServerExternalRuntimeSpecifier(
  specifier: string,
  configuredPackages?: readonly string[],
  supportsNpmSpecifiers = false,
): string | undefined {
  const match = matchConfiguredServerExternalSpecifier(specifier, configuredPackages);
  if (match === undefined) return undefined;

  const hasNpmProtocol = stringStartsWith(specifier, "npm:");
  if (hasNpmProtocol && supportsNpmSpecifiers) return specifier;
  return match.runtimeSpecifier;
}

/** Safe, actionable diagnostic for an explicitly declared server package crossing into a client build. */
export function describeServerExternalBrowserViolation(
  specifier: string,
  sourceModule?: string,
  projectDir?: string,
): { message: string; sourceIdentity?: string } {
  const rawSourceIdentity = getProjectRelativeModuleIdentity(sourceModule, projectDir);
  const sourceIdentity = rawSourceIdentity === undefined
    ? undefined
    : sanitizeDiagnosticValue(rawSourceIdentity);
  const esmSh = parseConfiguredExternalEsmShUrl(specifier);
  const displaySpecifier = esmSh === null ? specifier : `${esmSh.packageName}${esmSh.subpath}`;
  const location = rawSourceIdentity
    ? ` from browser module ${quoteDiagnosticValue(rawSourceIdentity)}`
    : " in a browser bundle";
  return {
    message:
      `Cannot import ${
        quoteDiagnosticValue(displaySpecifier)
      }${location} because its package is declared in build.serverExternalPackages. ` +
      "Move the import to server-only code, or remove the declaration if the package supports browsers.",
    sourceIdentity,
  };
}

export { SERVER_ONLY_PACKAGES };

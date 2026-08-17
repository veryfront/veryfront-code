export interface ParsedEsmShUrl {
  readonly origin: string;
  readonly packageName: string;
  readonly version: string | null;
  readonly subpath: string;
  /** True when the remaining path is an esm.sh build artifact, not an npm subpath. */
  readonly buildArtifact?: true;
  readonly search: string;
  readonly hash: string;
}

const ReflectApply = Reflect.apply;
const SetHas = Set.prototype.has;
const StringCharCodeAt = String.prototype.charCodeAt;
const StringEndsWith = String.prototype.endsWith;
const StringIncludes = String.prototype.includes;
const StringIndexOf = String.prototype.indexOf;
const StringLastIndexOf = String.prototype.lastIndexOf;
const StringSlice = String.prototype.slice;
const StringSplit = String.prototype.split;
const StringStartsWith = String.prototype.startsWith;
const URLConstructor = URL;
const DecodeURIComponent = decodeURIComponent;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const URLOriginGetter = getOwnPropertyDescriptor(URL.prototype, "origin")!.get!;
const URLPathnameGetter = getOwnPropertyDescriptor(URL.prototype, "pathname")!.get!;
const URLProtocolGetter = getOwnPropertyDescriptor(URL.prototype, "protocol")!.get!;
const URLHostnameGetter = getOwnPropertyDescriptor(URL.prototype, "hostname")!.get!;
const URLPortGetter = getOwnPropertyDescriptor(URL.prototype, "port")!.get!;
const URLSearchGetter = getOwnPropertyDescriptor(URL.prototype, "search")!.get!;
const URLHashGetter = getOwnPropertyDescriptor(URL.prototype, "hash")!.get!;
const ESM_SH_NON_NPM_PREFIXES: ReadonlySet<string> = new Set([
  "stable",
  "gh",
  "jsr",
  "pr",
  "node",
]);
const CONFIGURED_EXTERNAL_URL_BASE = "https://veryfront.invalid/";

function stringIncludes(value: string, search: string): boolean {
  return ReflectApply(StringIncludes, value, [search]) as boolean;
}

function stringCharCodeAt(value: string, index: number): number {
  return ReflectApply(StringCharCodeAt, value, [index]) as number;
}

function stringEndsWith(value: string, search: string): boolean {
  return ReflectApply(StringEndsWith, value, [search]) as boolean;
}

function stringLastIndexOf(value: string, search: string): number {
  return ReflectApply(StringLastIndexOf, value, [search]) as number;
}

function stringIndexOf(value: string, search: string): number {
  return ReflectApply(StringIndexOf, value, [search]) as number;
}

function stringSlice(value: string, start: number, end?: number): string {
  return ReflectApply(StringSlice, value, end === undefined ? [start] : [start, end]) as string;
}

function stringSplit(value: string, separator: string): string[] {
  return ReflectApply(StringSplit, value, [separator]) as string[];
}

function stringStartsWith(value: string, search: string): boolean {
  return ReflectApply(StringStartsWith, value, [search]) as boolean;
}

function setHas<T>(set: ReadonlySet<T>, value: T): boolean {
  return ReflectApply(SetHas, set, [value]) as boolean;
}

function getUrlString(url: URL, getter: (this: URL) => string): string {
  return ReflectApply(getter, url, []) as string;
}

function isVersionedBuildPrefix(value: string): boolean {
  if (value.length < 2 || value[0] !== "v") return false;
  for (let index = 1; index < value.length; index++) {
    const code = stringCharCodeAt(value, index);
    if (code < 48 || code > 57) return false;
  }
  return true;
}

function isBuildTarget(value: string): boolean {
  if (value === "deno" || value === "denonext" || value === "node" || value === "esnext") {
    return true;
  }
  if (value.length !== 6 || value[0] !== "e" || value[1] !== "s") return false;
  for (let index = 2; index < value.length; index++) {
    const code = stringCharCodeAt(value, index);
    if (code < 48 || code > 57) return false;
  }
  return true;
}

function isBuildArtifactPath(
  segments: readonly string[],
  subpathIndex: number,
  segmentCount: number,
): boolean {
  if (segmentCount < subpathIndex + 2 || !isBuildTarget(segments[subpathIndex]!)) return false;
  const filename = segments[segmentCount - 1]!;
  return stringEndsWith(filename, ".mjs") || stringEndsWith(filename, ".map") ||
    stringEndsWith(filename, ".css");
}

/** Check if a URL is hosted by the canonical esm.sh origin. */
export function isEsmShUrl(url: string): boolean {
  return stringStartsWith(url, "https://esm.sh/") || stringStartsWith(url, "http://esm.sh/");
}

/**
 * Split an esm.sh URL into its npm coordinates. Returns null for anything that
 * is not a plain `pkg`, `pkg@version`, or `@scope/pkg` path.
 */
export function parseEsmShUrl(url: string): ParsedEsmShUrl | null {
  if (!isEsmShUrl(url)) return null;
  const parsed = constructUrl(url);
  return parsed === null ? null : parseClassifiedEsmShUrl(parsed, false);
}

/** Parse esm.sh spellings accepted by browser URL resolution for policy enforcement. */
export function parseConfiguredExternalEsmShUrl(url: string): ParsedEsmShUrl | null {
  const parsed = constructUrl(url, CONFIGURED_EXTERNAL_URL_BASE);
  if (parsed === null) return null;

  const protocol = getUrlString(parsed, URLProtocolGetter);
  const hostname = getUrlString(parsed, URLHostnameGetter);
  const port = getUrlString(parsed, URLPortGetter);
  if (
    (protocol !== "https:" && protocol !== "http:") ||
    (hostname !== "esm.sh" && hostname !== "esm.sh.") || port !== ""
  ) {
    return null;
  }
  return parseClassifiedEsmShUrl(parsed, true);
}

function constructUrl(url: string, base?: string): URL | null {
  try {
    return base === undefined ? new URLConstructor(url) : new URLConstructor(url, base);
  } catch (_) {
    return null;
  }
}

function parseClassifiedEsmShUrl(
  parsed: URL,
  enforcementMode: boolean,
): ParsedEsmShUrl | null {
  let pathname = stringSlice(getUrlString(parsed, URLPathnameGetter), 1);
  if (enforcementMode) {
    try {
      pathname = ReflectApply(DecodeURIComponent, undefined, [pathname]) as string;
    } catch (_) {
      return null;
    }
    const backslashIndex = stringIndexOf(pathname, "\\");
    if (backslashIndex >= 0) pathname = stringSlice(pathname, 0, backslashIndex);
  }

  const segments = stringSplit(pathname, "/");
  let segmentCount = segments.length;
  if (
    enforcementMode && segmentCount > 1 && segments[segmentCount - 1]!.length === 0
  ) {
    segmentCount--;
  }
  for (let index = 0; index < segmentCount; index++) {
    if (segments[index]!.length === 0) return null;
  }

  let coordinateIndex = 0;
  let hasBuildPrefix = false;
  const leading = segments[0];
  if (
    enforcementMode && leading !== undefined &&
    (isVersionedBuildPrefix(leading) || leading === "stable")
  ) {
    coordinateIndex = 1;
    hasBuildPrefix = true;
  }
  const first = segments[coordinateIndex];
  if (
    !first || isVersionedBuildPrefix(first) || setHas(ESM_SH_NON_NPM_PREFIXES, first) ||
    stringIncludes(first, ":")
  ) {
    return null;
  }

  const isScoped = stringStartsWith(first, "@");
  if (isScoped && segmentCount < coordinateIndex + 2) return null;

  const packageSegmentIndex = isScoped ? coordinateIndex + 1 : coordinateIndex;
  const last = segments[packageSegmentIndex]!;
  const versionIndex = stringLastIndexOf(last, "@");
  if (versionIndex > 0 && versionIndex === last.length - 1) return null;
  const version = versionIndex > 0 ? stringSlice(last, versionIndex + 1) : null;
  const unversionedLast = versionIndex > 0 ? stringSlice(last, 0, versionIndex) : last;
  const packageName = isScoped ? `${first}/${unversionedLast}` : unversionedLast;
  let subpath = "";
  for (let index = packageSegmentIndex + 1; index < segmentCount; index++) {
    subpath += `/${segments[index]}`;
  }
  const buildArtifact = enforcementMode && (hasBuildPrefix ||
    isBuildArtifactPath(segments, packageSegmentIndex + 1, segmentCount));

  return {
    origin: getUrlString(parsed, URLOriginGetter),
    packageName,
    version: version && version.length > 0 ? version : null,
    subpath,
    ...(buildArtifact ? { buildArtifact: true as const } : {}),
    search: getUrlString(parsed, URLSearchGetter),
    hash: getUrlString(parsed, URLHashGetter),
  };
}

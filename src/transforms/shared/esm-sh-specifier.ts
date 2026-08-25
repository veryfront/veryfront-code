export interface ParsedEsmShUrl {
  readonly origin: string;
  readonly packageName: string;
  readonly version: string | null;
  readonly subpath: string;
  readonly search: string;
  readonly hash: string;
}

const ReflectApply = Reflect.apply;
const SetHas = Set.prototype.has;
const StringCharCodeAt = String.prototype.charCodeAt;
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
const ESM_SH_BUILD_TARGETS: ReadonlySet<string> = new Set([
  "es2015",
  "es2016",
  "es2017",
  "es2018",
  "es2019",
  "es2020",
  "es2021",
  "es2022",
  "es2023",
  "es2024",
  "esnext",
  "deno",
  "denonext",
  "node",
]);
const CONFIGURED_EXTERNAL_URL_BASE = "https://veryfront.invalid/";

function stringIncludes(value: string, search: string): boolean {
  return ReflectApply(StringIncludes, value, [search]) as boolean;
}

function stringCharCodeAt(value: string, index: number): number {
  return ReflectApply(StringCharCodeAt, value, [index]) as number;
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

function stringEndsWith(value: string, suffix: string): boolean {
  return suffix.length <= value.length &&
    stringLastIndexOf(value, suffix) === value.length - suffix.length;
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

function isValidEsmShBuildArgsPrefix(value: string): boolean {
  if (!stringStartsWith(value, "X-")) return false;
  const encodedLength = value.length - "X-".length;
  if (encodedLength === 0 || encodedLength % 4 === 1) return false;
  for (let index = "X-".length; index < value.length; index++) {
    const code = stringCharCodeAt(value, index);
    const isAlphaNumeric = (code >= 48 && code <= 57) ||
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122);
    if (!isAlphaNumeric && code !== 45 && code !== 95) return false;
  }
  return true;
}

function stripEsmShBuildModeSuffix(value: string): string {
  let stripped = value;
  if (stringEndsWith(value, ".nobundle")) {
    stripped = stringSlice(value, 0, -".nobundle".length);
  } else if (stringEndsWith(value, ".bundle")) {
    stripped = stringSlice(value, 0, -".bundle".length);
  }
  return stringEndsWith(stripped, ".development")
    ? stringSlice(stripped, 0, -".development".length)
    : stripped;
}

/** Recover an installed package subpath when the remaining URL is a generated esm.sh artifact. */
function getEsmShBuildArtifactSubpath(
  segments: readonly string[],
  startIndex: number,
  segmentCount: number,
  packageName: string,
  hasBuildPathEvidence: boolean,
): string | null {
  let targetIndex = startIndex;
  if (targetIndex >= segmentCount) return null;
  const hasBuildArgsPrefix = isValidEsmShBuildArgsPrefix(segments[targetIndex]!);
  if (hasBuildArgsPrefix) targetIndex++;
  if (targetIndex >= segmentCount || !setHas(ESM_SH_BUILD_TARGETS, segments[targetIndex]!)) {
    return null;
  }

  const artifactStart = targetIndex + 1;
  const lastArtifactSegment = segments[segmentCount - 1];
  if (artifactStart >= segmentCount || !lastArtifactSegment) return null;
  if (!stringEndsWith(lastArtifactSegment, ".mjs")) return null;
  if (artifactStart < segmentCount - 1 && !hasBuildPathEvidence && !hasBuildArgsPrefix) return null;

  let artifactSubpath = "";
  for (let index = artifactStart; index < segmentCount - 1; index++) {
    artifactSubpath += `${segments[index]}/`;
  }
  artifactSubpath += stripEsmShBuildModeSuffix(
    stringSlice(lastArtifactSegment, 0, -".mjs".length),
  );

  const packageSeparator = stringLastIndexOf(packageName, "/");
  const packageBasenameWithExtension = packageSeparator < 0
    ? packageName
    : stringSlice(packageName, packageSeparator + 1);
  const packageBasename = stringEndsWith(packageBasenameWithExtension, ".js")
    ? stringSlice(packageBasenameWithExtension, 0, -".js".length)
    : packageBasenameWithExtension;
  if (artifactSubpath === packageBasename) return "";
  if (artifactSubpath === `__${packageBasename}`) return `/${packageBasename}`;
  return `/${artifactSubpath}`;
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
  const leading = segments[0];
  if (
    enforcementMode && leading !== undefined &&
    (isVersionedBuildPrefix(leading) || leading === "stable")
  ) {
    coordinateIndex = 1;
  }
  if (coordinateIndex >= segmentCount) return null;
  let first = segments[coordinateIndex]!;
  const hasExternalAllPrefix = enforcementMode && stringStartsWith(first, "*");
  if (hasExternalAllPrefix) first = stringSlice(first, 1);
  if (
    !first || isVersionedBuildPrefix(first) || setHas(ESM_SH_NON_NPM_PREFIXES, first) ||
    stringIncludes(first, ":")
  ) {
    return null;
  }

  const isScoped = stringStartsWith(first, "@");
  if (isScoped && segmentCount < coordinateIndex + 2) return null;

  const packageSegmentIndex = isScoped ? coordinateIndex + 1 : coordinateIndex;
  const last = packageSegmentIndex === coordinateIndex ? first : segments[packageSegmentIndex]!;
  const versionIndex = stringLastIndexOf(last, "@");
  if (versionIndex > 0 && versionIndex === last.length - 1) return null;
  const version = versionIndex > 0 ? stringSlice(last, versionIndex + 1) : null;
  const unversionedLast = versionIndex > 0 ? stringSlice(last, 0, versionIndex) : last;
  const packageName = isScoped ? `${first}/${unversionedLast}` : unversionedLast;
  const firstSubpathIndex = packageSegmentIndex + 1;
  const artifactSubpath = enforcementMode
    ? getEsmShBuildArtifactSubpath(
      segments,
      firstSubpathIndex,
      segmentCount,
      packageName,
      hasExternalAllPrefix,
    )
    : null;
  let subpath = artifactSubpath ?? "";
  if (artifactSubpath === null) {
    for (let index = firstSubpathIndex; index < segmentCount; index++) {
      subpath += `/${segments[index]}`;
    }
  }

  return {
    origin: getUrlString(parsed, URLOriginGetter),
    packageName,
    version: version && version.length > 0 ? version : null,
    subpath,
    search: getUrlString(parsed, URLSearchGetter),
    hash: getUrlString(parsed, URLHashGetter),
  };
}

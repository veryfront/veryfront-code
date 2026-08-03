/** Framework modules that must never be resolved from project-authored imports. */
const PRIVATE_FRAMEWORK_MODULE_PREFIXES = [
  "agent/hosted/internal/",
  "tool/internal/",
] as const;

const DecodeURIComponent = decodeURIComponent;
const ReflectApply = Reflect.apply;
const ArrayPrototypeJoin = Array.prototype.join;
const StringPrototypeReplaceAll = String.prototype.replaceAll;
const StringPrototypeSlice = String.prototype.slice;
const StringPrototypeSplit = String.prototype.split;
const StringPrototypeStartsWith = String.prototype.startsWith;
const StringPrototypeToLowerCase = String.prototype.toLowerCase;

function startsWith(value: string, prefix: string): boolean {
  return ReflectApply(StringPrototypeStartsWith, value, [prefix]) as boolean;
}

function slice(value: string, start: number, end?: number): string {
  return ReflectApply(
    StringPrototypeSlice,
    value,
    end === undefined ? [start] : [start, end],
  ) as string;
}

function isAsciiLetter(value: string | undefined): boolean {
  return value !== undefined &&
    ((value >= "a" && value <= "z") || (value >= "A" && value <= "Z"));
}

function startsWithAsciiCaseInsensitive(value: string, prefix: string): boolean {
  if (value.length < prefix.length) return false;
  for (let index = 0; index < prefix.length; index++) {
    const character = value[index]!;
    const expected = prefix[index]!;
    if (
      character !== expected &&
      ReflectApply(StringPrototypeToLowerCase, character, []) !== expected
    ) {
      return false;
    }
  }
  return true;
}

function stripUrlSuffix(value: string): string {
  for (let index = 0; index < value.length; index++) {
    if (value[index] === "?" || value[index] === "#") {
      return slice(value, 0, index);
    }
  }
  return value;
}

function extractLocalFilePath(value: string): string | null {
  let path = stripUrlSuffix(value);
  if (startsWithAsciiCaseInsensitive(path, "file:")) {
    path = slice(path, 5);
    const hasAuthority = (path[0] === "/" || path[0] === "\\") &&
      (path[1] === "/" || path[1] === "\\");
    if (hasAuthority) {
      path = slice(path, 2);
      let authorityEnd = 0;
      while (
        authorityEnd < path.length &&
        path[authorityEnd] !== "/" && path[authorityEnd] !== "\\"
      ) {
        authorityEnd++;
      }
      const authority = ReflectApply(
        StringPrototypeToLowerCase,
        slice(path, 0, authorityEnd),
        [],
      ) as string;
      if (authority !== "" && authority !== "localhost") return null;
      path = slice(path, authorityEnd);
    }
  }

  const isAbsolutePath = path[0] === "/" || path[0] === "\\" ||
    (isAsciiLetter(path[0]) && path[1] === ":" &&
      (path[2] === "/" || path[2] === "\\"));
  return isAbsolutePath ? path : null;
}

function trimTrailing(value: string, characters: string): string {
  let result = value;
  while (result.length > 0) {
    const lastCharacter = result[result.length - 1]!;
    let shouldTrim = false;
    for (let index = 0; index < characters.length; index++) {
      if (lastCharacter === characters[index]) {
        shouldTrim = true;
        break;
      }
    }
    if (!shouldTrim) break;
    result = slice(result, 0, -1);
  }
  return result;
}

function repeatedlyDecodePath(value: string): string {
  let decoded = value;
  for (let index = 0; index < 4; index++) {
    try {
      const next = ReflectApply(DecodeURIComponent, undefined, [decoded]) as string;
      if (next === decoded) return decoded;
      decoded = next;
    } catch {
      return decoded;
    }
  }
  return decoded;
}

function stripFrameworkModulePrefix(value: string): string {
  const decoded = ReflectApply(StringPrototypeReplaceAll, repeatedlyDecodePath(value), [
    "\\",
    "/",
  ]) as string;
  let withoutLeadingSlashes = decoded;
  while (startsWith(withoutLeadingSlashes, "/")) {
    withoutLeadingSlashes = slice(withoutLeadingSlashes, 1);
  }

  const internalPrefix = "#veryfront/";
  if (startsWith(withoutLeadingSlashes, internalPrefix)) {
    return slice(withoutLeadingSlashes, internalPrefix.length);
  }

  const frameworkPrefix = "_veryfront/";
  if (startsWith(withoutLeadingSlashes, frameworkPrefix)) {
    return slice(withoutLeadingSlashes, frameworkPrefix.length);
  }

  const modulePrefix = "_vf_modules/";
  if (startsWith(withoutLeadingSlashes, modulePrefix)) {
    let nestedPath = slice(withoutLeadingSlashes, modulePrefix.length);
    while (startsWith(nestedPath, "/")) nestedPath = slice(nestedPath, 1);
    if (startsWith(nestedPath, frameworkPrefix)) {
      return slice(nestedPath, frameworkPrefix.length);
    }
  }

  return decoded;
}

function canonicalizePath(value: string, foldFilesystemAliases: boolean): string {
  const withoutPrefix = stripFrameworkModulePrefix(value);
  const segments: string[] = [];
  const rawSegments = ReflectApply(StringPrototypeSplit, withoutPrefix, ["/"]) as string[];
  for (let index = 0; index < rawSegments.length; index++) {
    const rawSegment = rawSegments[index]!;
    const spaceTrimmedSegment = trimTrailing(rawSegment, " ");
    const segment = foldFilesystemAliases
      ? spaceTrimmedSegment === "." || spaceTrimmedSegment === ".."
        ? spaceTrimmedSegment
        : ReflectApply(StringPrototypeToLowerCase, trimTrailing(rawSegment, ". "), []) as string
      : rawSegment;
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (segments.length > 0) segments.length--;
      continue;
    }
    segments[segments.length] = segment;
  }
  return ReflectApply(ArrayPrototypeJoin, segments, ["/"]) as string;
}

/** Canonicalize a framework module path for normal module resolution. */
export function canonicalizeFrameworkModulePath(value: string): string {
  return canonicalizePath(value, false);
}

/** Return whether the canonical path belongs to a host-only framework subtree. */
export function isPrivateFrameworkModulePath(value: string): boolean {
  const canonicalPath = canonicalizePath(value, true);
  for (let index = 0; index < PRIVATE_FRAMEWORK_MODULE_PREFIXES.length; index++) {
    const prefix = PRIVATE_FRAMEWORK_MODULE_PREFIXES[index]!;
    if (
      canonicalPath === slice(prefix, 0, -1) ||
      startsWith(canonicalPath, prefix)
    ) {
      return true;
    }
  }
  return false;
}

/** Return whether a local file specifier resolves inside a host-only framework subtree. */
export function isPrivateFrameworkFileSpecifier(
  value: string,
  frameworkSourceUrl: string,
): boolean {
  const candidatePath = extractLocalFilePath(value);
  const sourcePath = extractLocalFilePath(frameworkSourceUrl);
  if (candidatePath === null || sourcePath === null) return false;

  const candidate = canonicalizePath(candidatePath, true);
  const sourceRoot = trimTrailing(canonicalizePath(sourcePath, true), "/");
  if (!startsWith(candidate, `${sourceRoot}/`)) return false;

  return isPrivateFrameworkModulePath(slice(candidate, sourceRoot.length + 1));
}

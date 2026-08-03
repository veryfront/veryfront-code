/** Framework modules that must never be resolved from project-authored imports. */
const PRIVATE_FRAMEWORK_MODULE_PREFIXES = [
  "agent/hosted/internal/",
  "tool/internal/",
] as const;

function repeatedlyDecodePath(value: string): string {
  let decoded = value;
  for (let index = 0; index < 4; index++) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) return decoded;
      decoded = next;
    } catch {
      return decoded;
    }
  }
  return decoded;
}

function stripFrameworkModulePrefix(value: string): string {
  const decoded = repeatedlyDecodePath(value).replaceAll("\\", "/");
  return decoded
    .replace(/^\/*_vf_modules\/+_veryfront\//u, "")
    .replace(/^\/*_veryfront\//u, "")
    .replace(/^#veryfront\//u, "");
}

function canonicalizePath(value: string, foldFilesystemAliases: boolean): string {
  const withoutPrefix = stripFrameworkModulePrefix(value);
  const segments: string[] = [];
  for (const rawSegment of withoutPrefix.split("/")) {
    const spaceTrimmedSegment = rawSegment.replace(/ +$/gu, "");
    const segment = foldFilesystemAliases
      ? spaceTrimmedSegment === "." || spaceTrimmedSegment === ".."
        ? spaceTrimmedSegment
        : rawSegment.replace(/[. ]+$/gu, "").toLowerCase()
      : rawSegment;
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.join("/");
}

/** Canonicalize a framework module path for normal module resolution. */
export function canonicalizeFrameworkModulePath(value: string): string {
  return canonicalizePath(value, false);
}

/** Return whether the canonical path belongs to a host-only framework subtree. */
export function isPrivateFrameworkModulePath(value: string): boolean {
  const canonicalPath = canonicalizePath(value, true);
  return PRIVATE_FRAMEWORK_MODULE_PREFIXES.some((prefix) =>
    canonicalPath === prefix.slice(0, -1) || canonicalPath.startsWith(prefix)
  );
}

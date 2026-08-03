const MAX_GITHUB_PATH_CODE_UNITS = 4_096;

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x1f || (codeUnit >= 0x7f && codeUnit <= 0x9f)) return true;
  }
  return false;
}

function isUrlDoubleDotSegment(segment: string): boolean {
  return /^(?:\.|%2e)(?:\.|%2e)$/i.test(segment);
}

export function normalizeGitHubPath(path: string, projectDir: string = ""): string {
  const normalizedPath = normalizePathSegments(path, "path");
  const normalizedProjectDir = normalizePathSegments(projectDir, "projectDir");

  if (
    normalizedProjectDir &&
    (normalizedPath === normalizedProjectDir ||
      normalizedPath.startsWith(`${normalizedProjectDir}/`))
  ) {
    return normalizedPath.slice(normalizedProjectDir.length).replace(/^\/+/, "");
  }

  return normalizedPath;
}

function normalizePathSegments(value: string, label: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`GitHub ${label} must be a string`);
  }
  if (value.length > MAX_GITHUB_PATH_CODE_UNITS) {
    throw new TypeError(
      `GitHub ${label} exceeds the ${MAX_GITHUB_PATH_CODE_UNITS}-character limit`,
    );
  }
  if (hasControlCharacter(value)) {
    throw new TypeError(`GitHub ${label} must not contain control characters`);
  }
  if (value.includes("\\")) {
    throw new TypeError(`GitHub ${label} must use forward slashes`);
  }

  const collapsed = value.replace(/^\/+|\/+$/g, "").replace(/\/+/g, "/");
  const segments: string[] = [];
  for (const segment of collapsed.split("/")) {
    // "." segments are legitimate no-ops (a projectDir of "." conventionally
    // means the repository root); normalize them away instead of rejecting.
    if (segment === ".") continue;
    // ".." would escape the repository scope once the path is embedded in a
    // GitHub API URL (WHATWG URL resolution collapses dot segments): reject.
    if (isUrlDoubleDotSegment(segment)) {
      throw new TypeError(`GitHub ${label} must not contain ".." traversal segments`);
    }
    segments.push(segment);
  }
  return segments.join("/");
}

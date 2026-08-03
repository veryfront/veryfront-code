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

  const collapsed = value.replace(/^\/+|\/+$/g, "").replace(/\/+/g, "/");
  const segments: string[] = [];
  for (const segment of collapsed.split("/")) {
    // "." segments are legitimate no-ops (a projectDir of "." conventionally
    // means the repository root); normalize them away instead of rejecting.
    if (segment === ".") continue;
    // ".." would escape the repository scope once the path is embedded in a
    // GitHub API URL (WHATWG URL resolution collapses dot segments): reject.
    if (segment === "..") {
      throw new TypeError(`GitHub ${label} must not contain ".." traversal segments`);
    }
    segments.push(segment);
  }
  return segments.join("/");
}

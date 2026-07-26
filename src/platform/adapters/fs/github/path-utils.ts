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

  const normalized = value.replace(/^\/+|\/+$/g, "").replace(/\/+/g, "/");
  for (const segment of normalized.split("/")) {
    if (segment === "." || segment === "..") {
      throw new TypeError(`GitHub ${label} must not contain dot or traversal segments`);
    }
  }
  return normalized;
}

export function normalizeGitHubPath(path: string, projectDir: string = ""): string {
  let normalized = path;

  if (projectDir && normalized.startsWith(projectDir)) {
    normalized = normalized.slice(projectDir.length);
  }

  return normalized.replace(/^\/+/, "").replace(/\/+$/, "").replace(/\/+/g, "/");
}

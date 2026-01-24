export function resolveRelativePath(filePath: string, projectDir: string): string {
  const normalizedProjectDir = projectDir.replace(/\\/g, "/").replace(/\/$/, "");

  if (filePath.startsWith(normalizedProjectDir)) {
    return filePath.slice(normalizedProjectDir.length + 1);
  }

  if (!filePath.startsWith("/")) {
    return filePath;
  }

  const pathParts = filePath.split("/");
  const projectParts = normalizedProjectDir.split("/");
  const lastProjectPart = projectParts.at(-1);

  if (!lastProjectPart) {
    return filePath;
  }

  const projectIndex = pathParts.indexOf(lastProjectPart);
  if (projectIndex < 0) {
    return filePath;
  }

  return pathParts.slice(projectIndex + 1).join("/");
}

export function normalizeModulePath(filePath: string): string {
  return filePath.replace(/\.(tsx?|jsx)$/, ".js");
}

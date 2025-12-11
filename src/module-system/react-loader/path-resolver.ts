export function resolveRelativePath(
  filePath: string,
  projectDir: string,
): string {
  let relativeFilePath = filePath;

  const normalizedProjectDir = projectDir
    .replace(/\\/g, "/")
    .replace(/\/$/, "");

  if (filePath.startsWith(normalizedProjectDir)) {
    relativeFilePath = filePath.substring(normalizedProjectDir.length + 1);
    return relativeFilePath;
  }

  if (filePath.startsWith("/")) {
    const pathParts = filePath.split("/");
    const projectParts = normalizedProjectDir.split("/");
    const lastProjectPart = projectParts[projectParts.length - 1];

    if (lastProjectPart) {
      const projectIndex = pathParts.indexOf(lastProjectPart);
      if (projectIndex >= 0) {
        relativeFilePath = pathParts.slice(projectIndex + 1).join("/");
      }
    }
  }

  return relativeFilePath;
}

export function normalizeModulePath(filePath: string): string {
  return filePath.replace(/\.(tsx?|jsx)$/, ".js");
}

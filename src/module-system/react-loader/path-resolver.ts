export function resolveRelativePath(
  filePath: string,
  projectDir: string,
): string {
  const normalizedProjectDir = projectDir.replace(/\\/g, "/").replace(/\/$/, "");

  if (filePath.startsWith(normalizedProjectDir)) {
    return filePath.substring(normalizedProjectDir.length + 1);
  }

  if (filePath.startsWith("/")) {
    const pathParts = filePath.split("/");
    const projectParts = normalizedProjectDir.split("/");
    const lastProjectPart = projectParts[projectParts.length - 1];

    if (lastProjectPart) {
      const projectIndex = pathParts.indexOf(lastProjectPart);
      if (projectIndex >= 0) {
        return pathParts.slice(projectIndex + 1).join("/");
      }
    }
  }

  return filePath;
}

export function normalizeModulePath(filePath: string): string {
  // Convert all TypeScript/JSX extensions to .js for Node.js compatibility
  return filePath.replace(/\.(tsx?|jsx)$/, ".js");
}

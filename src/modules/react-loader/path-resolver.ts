import { isAbsolute, normalize } from "#veryfront/compat/path/index.ts";

const MAX_PATH_LENGTH = 32 * 1024;

function normalizeInputPath(value: string, label: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_PATH_LENGTH ||
    value.includes("\0")
  ) {
    throw new TypeError(
      `${label} must contain 1 to ${MAX_PATH_LENGTH} characters without NUL bytes`,
    );
  }
  const normalized = value.replace(/\\/g, "/");
  return normalized.length > 1 ? normalized.replace(/\/+$/, "") : normalized;
}

export function resolveRelativePath(filePath: string, projectDir: string): string {
  const normalizedFilePath = normalizeInputPath(filePath, "File path");
  const normalizedProjectDir = normalizeInputPath(projectDir, "Project directory");

  if (normalizedFilePath === normalizedProjectDir) return "";
  if (
    normalizedProjectDir === "/"
      ? normalizedFilePath.startsWith("/")
      : normalizedFilePath.startsWith(`${normalizedProjectDir}/`)
  ) {
    return normalizedFilePath.slice(
      normalizedProjectDir === "/" ? 1 : normalizedProjectDir.length + 1,
    );
  }

  if (!normalizedFilePath.startsWith("/")) return normalizedFilePath;

  const lastProjectPart = normalizedProjectDir.split("/").at(-1);
  if (!lastProjectPart) return normalizedFilePath;

  const fileParts = normalizedFilePath.split("/");
  const projectIndex = fileParts.lastIndexOf(lastProjectPart);
  if (projectIndex < 0) return normalizedFilePath;

  return fileParts.slice(projectIndex + 1).join("/");
}

/**
 * Resolve a path for use beneath a project-owned output directory.
 *
 * Unlike the display-oriented compatibility helper above, this rejects paths
 * that cannot be proven relative to the project and normalizes away dot
 * segments before the result reaches a filesystem join.
 */
export function resolveProjectRelativePath(
  filePath: string,
  projectDir: string,
): string {
  const candidate = resolveRelativePath(filePath, projectDir);
  if (isAbsolute(candidate)) {
    throw new TypeError(`File path is outside the project directory: ${filePath}`);
  }

  const normalized = normalize(candidate).replace(/\\/g, "/");
  if (
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../")
  ) {
    throw new TypeError(`File path escapes the project directory: ${filePath}`);
  }
  return normalized === "." ? "" : normalized;
}

export function normalizeModulePath(filePath: string): string {
  return filePath.replace(/\.(tsx?|jsx)$/, ".js");
}

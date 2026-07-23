import { isAbsolute, normalize, relative } from "#veryfront/compat/path/index.ts";
import { hasUnsafeControlCharacters } from "#veryfront/errors/text-validation.ts";

const MAX_MODULE_PATH_LENGTH = 4_096;

function validatePath(value: string, label: string): void {
  if (
    value.length === 0 || value.length > MAX_MODULE_PATH_LENGTH ||
    hasUnsafeControlCharacters(value)
  ) {
    throw new TypeError(`${label} is invalid`);
  }
}

export function resolveRelativePath(filePath: string, projectDir: string): string {
  validatePath(filePath, "filePath");
  validatePath(projectDir, "projectDir");

  const normalizedFilePath = normalize(filePath);
  if (!isAbsolute(normalizedFilePath)) {
    if (
      normalizedFilePath === "." || normalizedFilePath === ".." ||
      normalizedFilePath.startsWith("../")
    ) {
      throw new TypeError("filePath must not traverse outside projectDir");
    }
    return normalizedFilePath.replace(/^\.\//, "");
  }

  const projectRelativePath = relative(normalize(projectDir), normalizedFilePath);
  if (
    projectRelativePath === "." || projectRelativePath === ".." ||
    projectRelativePath.startsWith("../") || isAbsolute(projectRelativePath)
  ) {
    throw new TypeError("filePath must be inside projectDir");
  }
  return projectRelativePath;
}

export function normalizeModulePath(filePath: string): string {
  validatePath(filePath, "filePath");
  return filePath.replace(/\.(tsx?|jsx)$/, ".js");
}

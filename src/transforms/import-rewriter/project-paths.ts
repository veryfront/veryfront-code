/**
 * Project-relative path helpers shared by the rewrite strategies.
 *
 * Several strategies need the path of the file being transformed expressed
 * relative to the project root: the alias and relative strategies to build
 * module URLs, the asset strategy to name the importer in its message.
 */

/** Normalize separators and drop any trailing slash. */
function normalizeDir(dir: string): string {
  return dir.replace(/\\/g, "/").replace(/\/+$/, "");
}

/**
 * Path of `filePath` relative to `projectDir`, or null when the file is not
 * inside the project.
 *
 * The check is on a path boundary, so `/projectile/src/Header.tsx` is not
 * treated as living inside `/project`.
 */
export function relativeToProjectDir(filePath: string, projectDir: string): string | null {
  const normalizedFilePath = filePath.replace(/\\/g, "/");
  const normalizedProjectDir = normalizeDir(projectDir);

  if (normalizedFilePath === normalizedProjectDir) return "";
  if (!normalizedFilePath.startsWith(`${normalizedProjectDir}/`)) return null;

  return normalizedFilePath.slice(normalizedProjectDir.length + 1);
}

/**
 * Best-effort project-relative path, for callers that need a path to build a
 * module URL from and have no useful fallback.
 *
 * A file outside the project can still be a copy of a project file staged
 * somewhere else (a temp bundle directory, for example), so the project
 * directory name is looked up in the path before giving up and returning the
 * input unchanged.
 */
export function getProjectRelativePath(filePath: string, projectDir: string): string {
  const direct = relativeToProjectDir(filePath, projectDir);
  if (direct !== null) return direct;

  if (!filePath.startsWith("/")) return filePath;

  const pathParts = filePath.split("/");
  const lastProjectPart = normalizeDir(projectDir).split("/").at(-1);
  const projectIndex = lastProjectPart ? pathParts.indexOf(lastProjectPart) : -1;

  if (projectIndex >= 0) return pathParts.slice(projectIndex + 1).join("/");

  return filePath;
}

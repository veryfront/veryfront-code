import { logger as baseLogger } from "#veryfront/utils";
import { CONFIG_VALIDATION_FAILED } from "#veryfront/errors/error-registry/config.ts";

const logger = baseLogger.component("path-normalizer");
const MAX_PATH_CODE_UNITS = 4_096;

// Rejects the full non-printable control range (C0, DEL, and C1), the same
// policy as the GitHub path normalizer in ../github/path-utils.ts.
function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x1f || (codeUnit >= 0x7f && codeUnit <= 0x9f)) return true;
  }
  return false;
}

function normalizeForComparison(value: string): string {
  const isAbsolute = value.startsWith("/");
  const normalized = value
    .replace(/^\/+|\/+$/g, "")
    .replace(/\/+/g, "/")
    .split("/")
    .filter((segment) => segment !== ".")
    .join("/");
  return isAbsolute ? `/${normalized}` : normalized;
}

export class PathNormalizer {
  private readonly projectDirPrefix?: string;

  constructor(private readonly projectDir?: string) {
    if (projectDir !== undefined) {
      try {
        this.assertSafePath(projectDir, "project directory");
      } catch (cause) {
        throw CONFIG_VALIDATION_FAILED.create({
          detail: cause instanceof Error
            ? cause.message
            : "Filesystem project directory is invalid",
          cause,
        });
      }
      this.projectDirPrefix = normalizeForComparison(projectDir);
    }
  }

  getProjectDir(): string | undefined {
    return this.projectDir;
  }

  normalize(path: string): string {
    this.assertSafePath(path, "path");
    const normalizedPath = normalizeForComparison(path);

    const projectDir = this.projectDirPrefix;
    const wasAbsoluteInProject = projectDir !== undefined &&
      (projectDir === "/"
        ? normalizedPath.startsWith("/")
        : normalizedPath === projectDir || normalizedPath.startsWith(`${projectDir}/`));

    let normalized = normalizedPath;

    if (wasAbsoluteInProject) {
      normalized = projectDir === "/" ? normalized.slice(1) : normalized.slice(projectDir.length);
    }

    normalized = normalized.replace(/^\/+|\/+$/g, "").replace(/\/+/g, "/");

    // "." segments are legitimate no-ops (projectDir "." conventionally means
    // the project root elsewhere in this codebase); drop them instead of
    // rejecting the path. Parent-directory segments were rejected before any
    // configured project prefix could be stripped.
    const segments = normalized.split("/").filter((segment) => segment !== ".");
    normalized = segments.join("/");

    if (normalized.startsWith("@/")) {
      const original = normalized;
      normalized = normalized.slice(2);
      logger.debug("Stripped path alias", { original, normalized });
    }

    if (wasAbsoluteInProject && normalized !== path) {
      logger.debug("Converted absolute to relative path", {
        absolute: path,
        relative: normalized,
        projectDir: this.projectDir,
      });
    }

    return normalized;
  }

  private assertSafePath(path: string, label: string): void {
    if (typeof path !== "string") {
      throw new TypeError(`Filesystem ${label} must be a string`);
    }
    if (path.length > MAX_PATH_CODE_UNITS) {
      throw new TypeError(
        `Filesystem ${label} exceeds the ${MAX_PATH_CODE_UNITS}-character limit`,
      );
    }
    if (hasControlCharacter(path)) {
      throw new TypeError(`Filesystem ${label} must not contain control characters`);
    }
    if (path.includes("\\")) {
      throw new TypeError(`Filesystem ${label} must use forward slashes`);
    }
    if (path.split("/").some((segment) => segment === "..")) {
      throw new TypeError(`Filesystem ${label} must not contain ".." segments`);
    }
  }
}

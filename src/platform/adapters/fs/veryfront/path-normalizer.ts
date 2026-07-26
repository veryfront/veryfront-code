import { logger as baseLogger } from "#veryfront/utils";

const logger = baseLogger.component("path-normalizer");
const MAX_PATH_CODE_UNITS = 4_096;

function hasAsciiControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x1f || codeUnit === 0x7f) return true;
  }
  return false;
}

export class PathNormalizer {
  private readonly projectDirPrefix?: string;

  constructor(private readonly projectDir?: string) {
    if (projectDir !== undefined) {
      this.assertSafePath(projectDir, "project directory");
      this.projectDirPrefix = projectDir === "/" ? "/" : projectDir.replace(/\/+$/g, "");
    }
  }

  getProjectDir(): string | undefined {
    return this.projectDir;
  }

  normalize(path: string): string {
    this.assertSafePath(path, "path");

    const projectDir = this.projectDirPrefix;
    const wasAbsoluteInProject = projectDir !== undefined &&
      (projectDir === "/"
        ? path.startsWith("/")
        : path === projectDir || path.startsWith(`${projectDir}/`));

    let normalized = path;

    if (wasAbsoluteInProject) {
      normalized = projectDir === "/" ? normalized.slice(1) : normalized.slice(projectDir.length);
    }

    normalized = normalized.replace(/^\/+|\/+$/g, "").replace(/\/+/g, "/");

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

    const unsafeSegment = normalized.split("/").find((segment) =>
      segment === "." || segment === ".."
    );
    if (unsafeSegment) {
      throw new TypeError(`Filesystem path must not contain "${unsafeSegment}" segments`);
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
    if (hasAsciiControlCharacter(path)) {
      throw new TypeError(`Filesystem ${label} must not contain control characters`);
    }
    if (path.includes("\\")) {
      throw new TypeError(`Filesystem ${label} must use forward slashes`);
    }
  }
}

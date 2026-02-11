import { logger as baseLogger } from "#veryfront/utils";

const logger = baseLogger.component("path-normalizer");

export class PathNormalizer {
  constructor(private readonly projectDir?: string) {}

  getProjectDir(): string | undefined {
    return this.projectDir;
  }

  normalize(path: string): string {
    const projectDir = this.projectDir;
    const wasAbsoluteInProject = projectDir != null && path.startsWith(projectDir);

    let normalized = path;

    if (wasAbsoluteInProject) {
      normalized = normalized.slice(projectDir.length);
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
        projectDir,
      });
    }

    return normalized;
  }
}

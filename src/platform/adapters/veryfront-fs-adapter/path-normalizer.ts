import { logger } from "@veryfront/utils";

export class PathNormalizer {
  constructor(private readonly projectDir?: string) {}

  normalize(path: string): string {
    let normalized = path;

    if (this.projectDir && normalized.startsWith(this.projectDir)) {
      normalized = normalized.slice(this.projectDir.length);
    }

    normalized = normalized.replace(/^\/+|\/+$/g, "");
    normalized = normalized.replace(/\/+/g, "/");

    if (this.projectDir && path.startsWith(this.projectDir) && normalized !== path) {
      logger.debug("[PathNormalizer] Converted absolute to relative path", {
        absolute: path,
        relative: normalized,
        projectDir: this.projectDir,
      });
    }

    return normalized;
  }
}

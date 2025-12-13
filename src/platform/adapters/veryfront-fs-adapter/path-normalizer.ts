import { logger } from "@veryfront/utils";

export class PathNormalizer {
  constructor(private readonly projectDir?: string) {
    logger.debug("[PathNormalizer] Initialized", { projectDir: this.projectDir });
  }

  normalize(path: string): string {
    let normalized = path;

    if (this.projectDir && normalized.startsWith(this.projectDir)) {
      normalized = normalized.slice(this.projectDir.length);
    }

    normalized = normalized.replace(/^\/+|\/+$/g, "");
    normalized = normalized.replace(/\/+/g, "/");

    return normalized;
  }
}

import { join } from "../../../platform/compat/path/index.js";
import { logger } from "../../../utils/index.js";
import { createFileSystem } from "../../../platform/compat/fs.js";
import { withSpan } from "../../../observability/tracing/otlp-setup.js";
import { MANIFEST_FILENAME } from "./constants.js";
import type { OptimizedImageMetadata } from "./types.js";

export function writeManifest(
  imageManifest: Map<string, OptimizedImageMetadata>,
  outputDir: string,
): Promise<void> {
  return withSpan(
    "build.asset.writeManifest",
    async () => {
      const fs = createFileSystem();
      const manifestPath = join(outputDir, MANIFEST_FILENAME);

      await fs.writeTextFile(
        manifestPath,
        JSON.stringify(Object.fromEntries(imageManifest), null, 2),
      );

      logger.debug(`Wrote image manifest to ${manifestPath}`);
    },
    {
      "manifest.outputDir": outputDir,
      "manifest.imageCount": imageManifest.size,
    },
  );
}

export function loadManifest(
  outputDir: string,
): Promise<Map<string, OptimizedImageMetadata>> {
  return withSpan(
    "build.asset.loadManifest",
    async () => {
      const fs = createFileSystem();
      const manifestPath = join(outputDir, MANIFEST_FILENAME);

      try {
        const content = await fs.readTextFile(manifestPath);
        return new Map(Object.entries(JSON.parse(content)));
      } catch (error) {
        logger.warn("Failed to load image manifest", {
          error: error instanceof Error ? error.message : String(error),
        });
        return new Map();
      }
    },
    { "manifest.outputDir": outputDir },
  );
}

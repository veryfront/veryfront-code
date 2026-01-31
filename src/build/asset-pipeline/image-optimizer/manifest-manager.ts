import { join } from "#veryfront/platform/compat/path/index.ts";
import { logger } from "#veryfront/utils";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { MANIFEST_FILENAME } from "./constants.ts";
import type { OptimizedImageMetadata } from "./types.ts";

export function writeManifest(
  imageManifest: Map<string, OptimizedImageMetadata>,
  outputDir: string,
): Promise<void> {
  return withSpan(
    "build.asset.writeManifest",
    async (): Promise<void> => {
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
    async (): Promise<Map<string, OptimizedImageMetadata>> => {
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

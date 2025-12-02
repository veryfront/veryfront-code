import { join } from "std/path/mod.ts";
import { logger } from "@veryfront/utils";
import { createFileSystem } from "@veryfront/platform/compat/fs.ts";
import { MANIFEST_FILENAME } from "./constants.ts";
import type { OptimizedImageMetadata } from "./types.ts";

export async function writeManifest(
  imageManifest: Map<string, OptimizedImageMetadata>,
  outputDir: string,
): Promise<void> {
  const fs = createFileSystem();
  const manifestPath = join(outputDir, MANIFEST_FILENAME);
  const manifest = Object.fromEntries(imageManifest);

  await fs.writeTextFile(
    manifestPath,
    JSON.stringify(manifest, null, 2),
  );

  logger.debug(`Wrote image manifest to ${manifestPath}`);
}

export async function loadManifest(
  outputDir: string,
): Promise<Map<string, OptimizedImageMetadata>> {
  const fs = createFileSystem();
  const manifestPath = join(outputDir, MANIFEST_FILENAME);

  try {
    const content = await fs.readTextFile(manifestPath);
    const data = JSON.parse(content);
    return new Map(Object.entries(data));
  } catch (error) {
    logger.warn("Failed to load image manifest", {
      error: error instanceof Error ? error.message : String(error),
    });
    return new Map();
  }
}

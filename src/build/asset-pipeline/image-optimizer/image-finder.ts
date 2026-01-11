import { walk } from "std/fs/mod.ts";
import { extname } from "@veryfront/platform/compat/path/index.ts";
import { logger } from "@veryfront/utils";
import { SUPPORTED_EXTENSIONS } from "./constants.ts";

const supportedExtensionsSet = new Set(SUPPORTED_EXTENSIONS);

export async function findImages(dir: string): Promise<string[]> {
  const images: string[] = [];

  try {
    for await (
      const entry of walk(dir, {
        includeDirs: false,
        followSymlinks: false,
      })
    ) {
      const ext = extname(entry.path).toLowerCase();
      if (supportedExtensionsSet.has(ext)) {
        images.push(entry.path);
      }
    }
  } catch (error) {
    logger.warn(`Failed to read directory ${dir}`, {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return images;
}

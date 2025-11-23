import { walk } from "std/fs/mod.ts";
import { extname } from "std/path/mod.ts";
import { logger } from "@veryfront/utils";
import { SUPPORTED_EXTENSIONS } from "./constants.ts";

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
      if (SUPPORTED_EXTENSIONS.includes(ext)) {
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

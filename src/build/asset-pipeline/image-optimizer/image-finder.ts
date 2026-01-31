import { walk } from "#std/fs.ts";
import { extname } from "#veryfront/platform/compat/path/index.ts";
import { logger } from "#veryfront/utils";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { SUPPORTED_EXTENSIONS } from "./constants.ts";

const supportedExtensionsSet = new Set(SUPPORTED_EXTENSIONS);

export function findImages(dir: string): Promise<string[]> {
  return withSpan(
    "build.asset.findImages",
    async (): Promise<string[]> => {
      const images: string[] = [];

      try {
        for await (
          const entry of walk(dir, {
            includeDirs: false,
            followSymlinks: false,
          })
        ) {
          const ext = extname(entry.path).toLowerCase();
          if (supportedExtensionsSet.has(ext)) images.push(entry.path);
        }
      } catch (error) {
        logger.warn(`Failed to read directory ${dir}`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }

      return images;
    },
    { "image.directory": dir },
  );
}

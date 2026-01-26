import { walk } from "../../../../deps/deno.land/std@0.220.0/fs/mod.js";
import { extname } from "../../../platform/compat/path/index.js";
import { logger } from "../../../utils/index.js";
import { withSpan } from "../../../observability/tracing/otlp-setup.js";
import { SUPPORTED_EXTENSIONS } from "./constants.js";

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
          if (!supportedExtensionsSet.has(ext)) continue;
          images.push(entry.path);
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

import { walk } from "#std/fs.ts";
import { extname } from "#veryfront/compat/path/index.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { SUPPORTED_EXTENSIONS } from "./constants.ts";
import { isNotFoundError } from "#veryfront/platform/compat/fs.ts";

const supportedExtensionsSet = new Set(SUPPORTED_EXTENSIONS);

export function findImages(dir: string): Promise<string[]> {
  if (typeof dir !== "string" || dir.trim() === "") {
    throw new TypeError("Image input directory must not be blank");
  }
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
        if (!isNotFoundError(error)) throw error;
      }

      return images.sort();
    },
    {},
  );
}

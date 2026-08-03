import { join } from "#veryfront/compat/path/index.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { createFileSystem, type FileSystem } from "#veryfront/platform/compat/fs.ts";
import { getOptimizableImageSourceExtension } from "#veryfront/utils/image-variant-widths.ts";
import { MAX_IMAGE_FILES } from "./constants.ts";

const MAX_DIRECTORY_DEPTH = 64;
const MAX_DISCOVERED_ENTRIES = 1_000_000;

interface ImageFinderDependencies {
  fs?: FileSystem;
  /** @internal Allows focused tests to exercise the production limit. */
  maxImages?: number;
}

function comparePaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function findImages(
  dir: string,
  dependencies: ImageFinderDependencies = {},
): Promise<string[]> {
  return withSpan(
    "build.asset.findImages",
    async (): Promise<string[]> => {
      const fs = dependencies.fs ?? createFileSystem();
      const maxImages = dependencies.maxImages ?? MAX_IMAGE_FILES;
      if (
        !Number.isInteger(maxImages) ||
        maxImages <= 0 ||
        maxImages > MAX_IMAGE_FILES
      ) {
        throw new TypeError(
          `Image discovery limit must be an integer from 1 through ${MAX_IMAGE_FILES}`,
        );
      }

      const images: string[] = [];
      let discoveredEntries = 0;

      const visit = async (currentDir: string, depth: number): Promise<void> => {
        if (depth > MAX_DIRECTORY_DEPTH) {
          throw new TypeError(
            `Image directory nesting exceeds ${MAX_DIRECTORY_DEPTH} levels: ${currentDir}`,
          );
        }

        const entries = [];
        for await (const entry of fs.readDir(currentDir)) {
          discoveredEntries++;
          if (discoveredEntries > MAX_DISCOVERED_ENTRIES) {
            throw new TypeError(
              `Image discovery exceeds ${MAX_DISCOVERED_ENTRIES} filesystem entries`,
            );
          }
          entries.push(entry);
        }
        entries.sort((left, right) => comparePaths(left.name, right.name));

        for (const entry of entries) {
          if (entry.isSymlink) continue;
          const path = join(currentDir, entry.name);
          if (entry.isDirectory) {
            await visit(path, depth + 1);
            continue;
          }
          if (!entry.isFile) continue;
          if (getOptimizableImageSourceExtension(entry.name) === null) {
            continue;
          }
          images.push(path);
          if (images.length > maxImages) {
            throw new TypeError(
              `Image discovery exceeds the configured limit of ${maxImages} files`,
            );
          }
        }
      };

      await visit(dir, 0);
      return images.sort(comparePaths);
    },
    { "image.directory": dir },
  );
}

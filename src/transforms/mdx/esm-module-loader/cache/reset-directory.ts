import { type FileSystem, isNotFoundError } from "#veryfront/platform/compat/fs.ts";

type DirectoryResetFileSystem = Pick<FileSystem, "mkdir" | "remove">;

/**
 * Remove and recreate a cache directory.
 *
 * An absent directory is already empty, but must still be recreated. Every
 * operational failure propagates so callers never report a cache clear that
 * did not actually complete.
 */
export async function resetCacheDirectory(
  fs: DirectoryResetFileSystem,
  cacheDir: string,
): Promise<void> {
  try {
    await fs.remove(cacheDir, { recursive: true });
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
  }

  await fs.mkdir(cacheDir, { recursive: true });
}

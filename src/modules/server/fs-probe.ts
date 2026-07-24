/** Minimal stat surface shared by the secure and platform filesystems. */
interface StatCapableFs {
  stat(path: string): Promise<{ isFile: boolean }>;
}

/**
 * Resolve the first path in `paths` order that exists as a file, or null.
 * All candidates are stat-probed in parallel; order of `paths` decides the
 * winner, not which probe resolves first.
 */
export async function findFirstExistingFile(
  fs: StatCapableFs,
  paths: string[],
): Promise<string | null> {
  const results = await Promise.all(paths.map(async (path) => {
    try {
      const stat = await fs.stat(path);
      return stat.isFile ? path : null;
    } catch {
      return null;
    }
  }));

  return results.find((path): path is string => path !== null) ?? null;
}

import { isNotFoundError } from "#veryfront/platform/compat/fs.ts";

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
  const probes = paths.map(async (path) => {
    try {
      const stat = await fs.stat(path);
      return { path: stat.isFile ? path : null } as const;
    } catch (error) {
      if (isNotFoundError(error)) return { path: null } as const;
      return { error } as const;
    }
  });

  // Every probe starts immediately, but results are consumed in candidate
  // order. A failure matters only until a preferred file has been selected;
  // lower-priority probes cannot invalidate or delay that selection.
  for (const probe of probes) {
    const outcome = await probe;
    if ("error" in outcome) throw outcome.error;
    if (outcome.path !== null) return outcome.path;
  }
  return null;
}

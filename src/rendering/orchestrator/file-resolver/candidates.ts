/**
 * File Resolution Candidate Utilities
 *
 * Utilities for building and finding file candidates with extension fallbacks.
 *
 * @module rendering/orchestrator/file-resolver/candidates
 */

/** Build candidate paths for a base path with extensions (direct and index variants) */
export function buildCandidatePaths(
  baseDir: string,
  fileName: string,
  extensions: string[],
): string[] {
  return [
    ...extensions.map((ext) => `${baseDir}/${fileName}${ext}`),
    ...extensions.map((ext) => `${baseDir}/${fileName}/index${ext}`),
  ];
}

/** Find the first existing path from candidates using the provided stat function */
export async function findFirstExisting(
  candidates: string[],
  statFn: (path: string) => Promise<unknown>,
): Promise<string | null> {
  const results = await Promise.all(
    candidates.map(async (fullPath) => {
      try {
        await statFn(fullPath);
        return fullPath;
      } catch {
        return null;
      }
    }),
  );
  return results.find((r) => r !== null) ?? null;
}

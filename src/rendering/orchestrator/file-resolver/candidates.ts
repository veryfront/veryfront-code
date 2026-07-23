export function buildCandidatePaths(
  baseDir: string,
  fileName: string,
  extensions: string[],
): string[] {
  return extensions.flatMap((ext) => [
    `${baseDir}/${fileName}${ext}`,
    `${baseDir}/${fileName}/index${ext}`,
  ]);
}

export async function findFirstExisting(
  candidates: string[],
  statFn: (path: string) => Promise<unknown>,
): Promise<string | null> {
  for (const fullPath of candidates) {
    try {
      await statFn(fullPath);
      return fullPath;
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
    }
  }
  return null;
}
import { isNotFoundError } from "#veryfront/platform/compat/fs.ts";

import { isAbsolute, join } from "#veryfront/compat/path/index.ts";
import { cwd } from "#veryfront/platform/compat/process.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { getCacheBaseDir } from "#veryfront/utils/cache-dir.ts";
import { hashString } from "#veryfront/cache/hash.ts";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import { hasUnsafeControlCharacters } from "#veryfront/errors/text-validation.ts";

const globalTmpDirs = new LRUCache<string, string>({ maxEntries: 32 });
const projectTmpDirs = new LRUCache<string, string>({ maxEntries: 1_000 });
const MAX_PROJECT_ID_LENGTH = 4_096;

/**
 * Create a safe directory name from projectId.
 * Uses a hash because Deno decodes %2F to / in file:// URLs,
 * making percent-encoded paths unusable for dynamic imports.
 */
function normalizeProjectKey(projectId: string): string {
  if (
    projectId.length === 0 || projectId.length > MAX_PROJECT_ID_LENGTH ||
    hasUnsafeControlCharacters(projectId)
  ) {
    throw new TypeError("projectId is invalid");
  }
  return `proj-${hashString(projectId)}`;
}

export async function getGlobalTmpDir(): Promise<string> {
  const cacheBaseDir = getCacheBaseDir();
  const baseDir = isAbsolute(cacheBaseDir) ? cacheBaseDir : join(cwd(), cacheBaseDir);

  const cached = globalTmpDirs.get(baseDir);
  if (cached) return cached;

  const tmpDir = join(baseDir, "veryfront-modules");
  await createFileSystem().mkdir(tmpDir, { recursive: true });

  globalTmpDirs.set(baseDir, tmpDir);
  return tmpDir;
}

export async function getProjectTmpDir(projectId: string): Promise<string> {
  const baseDir = await getGlobalTmpDir();
  const normalizedKey = normalizeProjectKey(projectId);
  const cacheKey = JSON.stringify([baseDir, normalizedKey]);

  const cached = projectTmpDirs.get(cacheKey);
  if (cached) return cached;

  const projectTmpDir = join(baseDir, normalizedKey);
  await createFileSystem().mkdir(projectTmpDir, { recursive: true });

  projectTmpDirs.set(cacheKey, projectTmpDir);
  return projectTmpDir;
}

export function resetGlobalTmpDir(): void {
  globalTmpDirs.clear();
  projectTmpDirs.clear();
}

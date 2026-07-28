import { isAbsolute, join } from "#veryfront/compat/path/index.ts";
import { cwd } from "#veryfront/platform/compat/process.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { getCacheBaseDir } from "#veryfront/utils/cache-dir.ts";
import { computeHash } from "#veryfront/utils/hash-utils.ts";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";

const MAX_GLOBAL_TMP_DIRS = 16;
const MAX_PROJECT_TMP_DIRS = 1_024;
const MAX_PROJECT_ID_LENGTH = 32 * 1024;
const globalTmpDirs = new LRUCache<string, string>({
  maxEntries: MAX_GLOBAL_TMP_DIRS,
});
const projectTmpDirs = new LRUCache<string, string>({
  maxEntries: MAX_PROJECT_TMP_DIRS,
});

/**
 * Create a safe directory name from projectId.
 * Uses a hash because Deno decodes %2F to / in file:// URLs,
 * making percent-encoded paths unusable for dynamic imports.
 */
async function normalizeProjectKey(projectId: string): Promise<string> {
  if (
    typeof projectId !== "string" ||
    projectId.length === 0 ||
    projectId.length > MAX_PROJECT_ID_LENGTH
  ) {
    throw new RangeError(
      `projectId must contain 1 to ${MAX_PROJECT_ID_LENGTH} characters`,
    );
  }

  return `proj-${await computeHash(`veryfront:module-tmp:v1\0${projectId}`)}`;
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
  const normalizedKey = await normalizeProjectKey(projectId);
  const cacheKey = `${baseDir}:${normalizedKey}`;

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

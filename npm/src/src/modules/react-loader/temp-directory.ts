import { isAbsolute, join } from "../../platform/compat/path/index.js";
import { cwd } from "../../platform/compat/process.js";
import { createFileSystem } from "../../platform/compat/fs.js";
import { getCacheBaseDir } from "../../utils/cache-dir.js";

const globalTmpDirs = new Map<string, string>();
const projectTmpDirs = new Map<string, string>();

/**
 * Create a safe directory name from projectId.
 * Uses a hash because Deno decodes %2F to / in file:// URLs,
 * making percent-encoded paths unusable for dynamic imports.
 */
function normalizeProjectKey(projectId: string): string {
  if (!projectId) return "default";

  let hash = 0;
  for (let i = 0; i < projectId.length; i++) {
    hash = (hash << 5) - hash + projectId.charCodeAt(i);
    hash |= 0;
  }

  return `proj-${Math.abs(hash).toString(16)}`;
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

import { isAbsolute, join } from "@veryfront/platform/compat/path/index.ts";
import { cwd } from "@veryfront/platform/compat/process.ts";
import { createFileSystem } from "@veryfront/platform/compat/fs.ts";
import { getCacheBaseDir } from "@veryfront/utils/cache-dir.ts";

const globalTmpDirs = new Map<string, string>();
const projectTmpDirs = new Map<string, string>();

/**
 * Create a safe directory name from projectId.
 * Uses a hash because Deno decodes %2F to / in file:// URLs,
 * making percent-encoded paths unusable for dynamic imports.
 */
function normalizeProjectKey(projectId: string): string {
  if (!projectId) return "default";
  // Simple hash to create a safe directory name
  let hash = 0;
  for (let i = 0; i < projectId.length; i++) {
    const char = projectId.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `proj-${Math.abs(hash).toString(16)}`;
}

export async function getGlobalTmpDir(): Promise<string> {
  const cacheBaseDir = getCacheBaseDir();
  const baseDir = isAbsolute(cacheBaseDir) ? cacheBaseDir : join(cwd(), cacheBaseDir);
  const cached = globalTmpDirs.get(baseDir);
  if (cached) {
    return cached;
  }

  // Use a cache dir outside node_modules to avoid triggering Node.js module resolution.
  // Any cache base dir works as long as it is outside node_modules.
  const tmpDir = join(baseDir, "veryfront-modules");
  const fs = createFileSystem();
  await fs.mkdir(tmpDir, { recursive: true });
  globalTmpDirs.set(baseDir, tmpDir);
  return tmpDir;
}

export async function getProjectTmpDir(projectId: string): Promise<string> {
  const normalizedKey = normalizeProjectKey(projectId);
  const baseDir = await getGlobalTmpDir();
  const cacheKey = `${baseDir}:${normalizedKey}`;
  const existing = projectTmpDirs.get(cacheKey);
  if (existing) {
    return existing;
  }

  const fs = createFileSystem();
  const projectTmpDir = join(baseDir, normalizedKey);
  await fs.mkdir(projectTmpDir, { recursive: true });
  projectTmpDirs.set(cacheKey, projectTmpDir);
  return projectTmpDir;
}

export function resetGlobalTmpDir(): void {
  globalTmpDirs.clear();
  projectTmpDirs.clear();
}

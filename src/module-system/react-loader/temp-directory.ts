import { join } from "@veryfront/platform/compat/path/index.ts";
import { cwd } from "@veryfront/platform/compat/process.ts";

let globalTmpDir: string | null = null;
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
  if (!globalTmpDir) {
    const fs = await import("node:fs/promises");
    // Use node_modules/.cache so bare imports can resolve to parent node_modules
    const projectDir = cwd();
    globalTmpDir = join(projectDir, "node_modules", ".cache", "veryfront-modules");
    await fs.mkdir(globalTmpDir, { recursive: true });
  }
  return globalTmpDir;
}

export async function getProjectTmpDir(projectId: string): Promise<string> {
  const normalizedKey = normalizeProjectKey(projectId);
  const existing = projectTmpDirs.get(normalizedKey);
  if (existing) {
    return existing;
  }

  const baseDir = await getGlobalTmpDir();
  const fs = await import("node:fs/promises");
  const projectTmpDir = join(baseDir, normalizedKey);
  await fs.mkdir(projectTmpDir, { recursive: true });
  projectTmpDirs.set(normalizedKey, projectTmpDir);
  return projectTmpDir;
}

export function resetGlobalTmpDir(): void {
  globalTmpDir = null;
  projectTmpDirs.clear();
}

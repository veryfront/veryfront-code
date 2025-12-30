import { join } from "std/path/mod.ts";
import { cwd } from "../../platform/compat/process.ts";

let globalTmpDir: string | null = null;

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

export function resetGlobalTmpDir(): void {
  globalTmpDir = null;
}

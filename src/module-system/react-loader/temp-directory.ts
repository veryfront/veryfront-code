import { join } from "std/path/mod.ts";

let globalTmpDir: string | null = null;

export async function getGlobalTmpDir(): Promise<string> {
  if (!globalTmpDir) {
    const os = await import("node:os");
    const fs = await import("node:fs/promises");
    const tmpBase = os.tmpdir();
    const tmpName = `vf-modules-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    globalTmpDir = join(tmpBase, tmpName);
    await fs.mkdir(globalTmpDir, { recursive: true });
  }
  return globalTmpDir;
}

export function resetGlobalTmpDir(): void {
  globalTmpDir = null;
}

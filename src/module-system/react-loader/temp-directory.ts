let globalTmpDir: string | null = null;

export async function getGlobalTmpDir(): Promise<string> {
  if (!globalTmpDir) {
    globalTmpDir = await Deno.makeTempDir({ prefix: "vf-modules-" });
  }
  return globalTmpDir;
}

export function resetGlobalTmpDir(): void {
  globalTmpDir = null;
}

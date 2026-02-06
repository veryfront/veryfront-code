export async function makeNodeTempDir(prefix: string): Promise<string> {
  const { mkdtemp } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  return mkdtemp(join(tmpdir(), prefix));
}

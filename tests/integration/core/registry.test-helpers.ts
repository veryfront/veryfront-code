import "../../_helpers/contract-init.ts";
import { dirname, join } from "#veryfront/compat/path";
import { mkdir, writeTextFile } from "#veryfront/testing/deno-compat";
import { getAdapter } from "#veryfront/platform/adapters/detect.ts";
import { ComponentRegistry } from "#veryfront/modules/component-registry/index.ts";

export async function createRegistry(projectDir: string): Promise<ComponentRegistry> {
  return new ComponentRegistry({ projectDir, adapter: await getAdapter() });
}

export async function writeProjectFiles(
  projectDir: string,
  files: Record<string, string>,
): Promise<void> {
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = join(projectDir, relativePath);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeTextFile(absolutePath, content);
  }
}

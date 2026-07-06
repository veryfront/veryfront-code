import { join } from "veryfront/platform/path";
import { createFileSystem } from "veryfront/platform";

const DENO_CONFIG = {
  nodeModulesDir: "auto",
  tasks: {
    dev: "veryfront dev",
    build: "veryfront build",
    preview: "veryfront preview",
  },
};

/**
 * Write a thin `deno.json` to the scaffolded project directory. Relies on
 * `nodeModulesDir: "auto"` so Deno reads dependencies from the
 * sibling `package.json` and materializes `node_modules/` on first task run.
 *
 * Throws if `deno.json` already exists at the destination — no template
 * ships one today, so an existing file means something unexpected.
 */
export async function createDenoConfig(projectDir: string): Promise<void> {
  const fs = createFileSystem();
  const target = join(projectDir, "deno.json");
  if (await fs.exists(target)) {
    throw new Error(`Refusing to overwrite existing deno.json at ${target}`);
  }
  await fs.writeTextFile(target, JSON.stringify(DENO_CONFIG, null, 2) + "\n");
}

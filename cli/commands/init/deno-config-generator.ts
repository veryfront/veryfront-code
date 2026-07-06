import { VERSION } from "#cli/utils";
import { join } from "veryfront/platform/path";
import { createFileSystem } from "veryfront/platform";

const VERYFRONT_DENO_SPEC = `npm:veryfront@${VERSION}`;

const DENO_CONFIG = {
  nodeModulesDir: "auto",
  tasks: {
    dev: `deno run -A ${VERYFRONT_DENO_SPEC} dev`,
    build: `deno run -A ${VERYFRONT_DENO_SPEC} build`,
    preview: `deno run -A ${VERYFRONT_DENO_SPEC} preview`,
  },
};

/**
 * Write a thin `deno.json` to the scaffolded project directory. Relies on
 * exact-version `npm:` specs so task execution stays hosted by Deno without
 * drifting to a newer CLI than the scaffolded dependencies.
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

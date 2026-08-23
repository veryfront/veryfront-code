import { VERSION } from "#cli/utils";
import { join } from "veryfront/platform/path";
import { createFileSystem, type FileSystem } from "veryfront/platform";

const VERYFRONT_DENO_SPEC = `npm:veryfront@${VERSION}`;

const DENO_CONFIG = {
  nodeModulesDir: "auto",
  tasks: {
    dev: `deno run -A ${VERYFRONT_DENO_SPEC} dev`,
    build: `deno run -A ${VERYFRONT_DENO_SPEC} build`,
    start: `deno run -A ${VERYFRONT_DENO_SPEC} serve`,
    eval: `deno run -A ${VERYFRONT_DENO_SPEC} eval`,
  },
};

/**
 * Render the scaffold's `deno.json`. Pure, so the disk-writing CLI path and
 * `materializeScaffold` emit the same bytes.
 */
export function buildDenoConfig(): string {
  return JSON.stringify(DENO_CONFIG, null, 2) + "\n";
}

/**
 * Write a thin `deno.json` to the scaffolded project directory. Relies on
 * exact-version `npm:` specs so task execution stays hosted by Deno without
 * drifting to a newer CLI than the scaffolded dependencies.
 *
 * Throws if `deno.json` already exists at the destination — no template
 * ships one today, so an existing file means something unexpected.
 */
export async function createDenoConfig(
  projectDir: string,
  fs: FileSystem = createFileSystem(),
): Promise<void> {
  const target = join(projectDir, "deno.json");
  if (await fs.exists(target)) {
    throw new Error(`Refusing to overwrite existing deno.json at ${target}`);
  }
  await fs.writeTextFile(target, buildDenoConfig());
}

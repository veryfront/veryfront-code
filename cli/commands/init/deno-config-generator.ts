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

export interface CreateDenoConfigOptions {
  /** Replace an existing config after the caller has completed conflict checks. */
  overwrite?: boolean;
}

/**
 * Write a thin `deno.json` to the scaffolded project directory. Relies on
 * exact-version `npm:` specs so task execution stays hosted by Deno without
 * drifting to a newer CLI than the scaffolded dependencies.
 *
 * Refuses an existing file by default. Project creation may opt into replacing
 * it after its conflict policy and path-safety preflight have both succeeded.
 */
export async function createDenoConfig(
  projectDir: string,
  fs: FileSystem = createFileSystem(),
  options: CreateDenoConfigOptions = {},
): Promise<void> {
  const target = join(projectDir, "deno.json");
  if (!options.overwrite && await fs.exists(target)) {
    throw new Error(`Refusing to overwrite existing deno.json at ${target}`);
  }
  await fs.writeTextFile(target, buildDenoConfig());
}

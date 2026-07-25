import { join } from "#veryfront/compat/path/index.ts";

/** Config filenames recognized by the Veryfront project loader. */
export const VERYFRONT_CONFIG_FILES = Object.freeze(
  [
    "veryfront.config.js",
    "veryfront.config.ts",
    "veryfront.config.mjs",
  ] as const,
);

export type VeryfrontConfigFileName = (typeof VERYFRONT_CONFIG_FILES)[number];

export interface VeryfrontConfigFile {
  fileName: VeryfrontConfigFileName;
  path: string;
}

export type ConfigFileExists = (path: string) => boolean | Promise<boolean>;

/**
 * Find the first project config file using the loader's canonical precedence.
 *
 * Filesystem errors are intentionally left to the caller so each boundary can
 * preserve its own required or best-effort behavior.
 */
export async function findVeryfrontConfigFile(
  projectDir: string,
  exists: ConfigFileExists,
): Promise<VeryfrontConfigFile | null> {
  for (const fileName of VERYFRONT_CONFIG_FILES) {
    const path = join(projectDir, fileName);
    if (await exists(path)) return { fileName, path };
  }

  return null;
}

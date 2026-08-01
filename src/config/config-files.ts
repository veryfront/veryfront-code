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

function joinConfigFilePath(
  projectDir: string,
  fileName: VeryfrontConfigFileName,
): string {
  const normalizedProjectDir = projectDir.replaceAll("\\", "/");
  if (/^\/\/[^/]+\/+[^/]+(?:\/|$)/.test(normalizedProjectDir)) {
    // The general path facade follows host POSIX semantics and therefore
    // collapses a leading double slash. At this configuration boundary both
    // accepted UNC spellings identify the same remote share, so preserve that
    // namespace explicitly while still normalizing the remaining segments.
    return `//${join(normalizedProjectDir.slice(2), fileName)}`;
  }
  return join(projectDir, fileName);
}

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
    const path = joinConfigFilePath(projectDir, fileName);
    if (await exists(path)) return { fileName, path };
  }

  return null;
}

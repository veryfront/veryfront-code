import { INVALID_ARGUMENT, SECURITY_VIOLATION } from "#veryfront/errors/error-registry/general.ts";

const MAX_TEMP_DIRECTORY_PREFIX_LENGTH = 128;

/** Validate the portable basename used to prefix a temporary directory. */
export function validateTempDirectoryPrefix(prefix: string): void {
  if (
    prefix.length === 0 || prefix.trim().length === 0 ||
    prefix.length > MAX_TEMP_DIRECTORY_PREFIX_LENGTH || prefix === "." || prefix === ".." ||
    prefix.includes("/") || prefix.includes("\\") || prefix.includes("\0")
  ) {
    throw INVALID_ARGUMENT.create({ message: "Temp directory prefix must be a safe basename" });
  }
}

/**
 * Atomically create a direct child of the operating system's canonical temp
 * directory. Native filesystem errors are preserved for compat callers.
 */
export async function createNodeTempDirectory(prefix: string): Promise<string> {
  validateTempDirectoryPrefix(prefix);

  const { mkdtemp, realpath, rm } = await import("node:fs/promises");
  const { dirname, join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const tempRoot = await realpath(tmpdir());
  const directory = await mkdtemp(join(tempRoot, prefix));

  try {
    const canonicalDirectory = await realpath(directory);
    if (dirname(canonicalDirectory) !== tempRoot) {
      throw SECURITY_VIOLATION.create({
        message: "Created temp directory escaped the temp root",
      });
    }
    return canonicalDirectory;
  } catch (error) {
    try {
      await rm(directory, { force: true, recursive: true });
    } catch {
      // Preserve the original validation or canonicalization error. The
      // caller cannot safely act on a secondary cleanup failure here.
    }
    throw error;
  }
}

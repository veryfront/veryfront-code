import { serverLogger as logger } from "#veryfront/utils";
import { join } from "#veryfront/compat/path/index.ts";
import { BUILD_FAILED, handleErrorWithFallback } from "#veryfront/errors";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";

/**
 * Entry every Veryfront build creates in its output directory (below), and so
 * the marker that the directory is a build artifact rather than a directory
 * the project keeps for itself.
 */
const BUILD_OUTPUT_MARKER = "_veryfront";

/** Names listed in the refusal message before it stops enumerating. */
const REFUSAL_PREVIEW_LIMIT = 5;

export async function setupBuildDirectories(
  adapter: RuntimeAdapter,
  outputDir: string,
  dryRun: boolean,
): Promise<void> {
  logger.debug("Setting up build directories...");

  // A dry run touches nothing at all. Clearing the output directory first
  // deleted the project's previous build output — and anything else the
  // project kept in dist/ — while the CLI was printing "no files will be
  // written", leaving the developer with neither the old artifact nor a new
  // one.
  if (dryRun) {
    logger.debug("Build directories ready");
    return;
  }

  if (await outputDirectoryNeedsClearing(adapter, outputDir)) {
    await handleErrorWithFallback(
      () => adapter.fs.remove(outputDir, { recursive: true }),
      undefined,
      logger,
    );
  }

  const fs = createFileSystem();
  const dirs = [
    outputDir,
    join(outputDir, "_veryfront"),
    join(outputDir, "_veryfront/chunks"),
    join(outputDir, "_veryfront/data"),
    join(outputDir, "assets"),
  ];

  for (const dir of dirs) {
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error
        ? (error as { code?: string }).code
        : undefined;

      if (code !== "EEXIST") throw error;
    }
  }

  logger.debug("Build directories ready");
}

/**
 * Decide whether the output directory may be deleted, and refuse when no
 * Veryfront build produced it.
 *
 * The build empties its output directory before writing. When the project
 * already keeps something there — its own `dist/` from tsc, esbuild or any
 * other tool — that step destroyed the lot while the CLI printed nothing but a
 * success line, so the loss was only ever discovered later, from the absence.
 * Deleting files no build wrote is not a step a developer can be assumed to
 * have consented to, and it cannot be undone, so it has to be asked about
 * rather than guessed at.
 *
 * A directory holding `_veryfront/` is a previous build's output: this same
 * function creates that entry before anything else is written, so every
 * directory the build has ever owned carries it — including one left by an
 * older release or by a build that failed halfway. Ownership is therefore
 * inherited without a new marker file, and upgrading does not turn every
 * existing `dist/` into an error. An empty directory has nothing to lose and
 * is cleared as before; an absent one needs no clearing at all.
 */
async function outputDirectoryNeedsClearing(
  adapter: RuntimeAdapter,
  outputDir: string,
): Promise<boolean> {
  const entries = await readOutputDirectoryEntries(adapter, outputDir);
  // Could not be inspected: keep the previous behaviour and let the removal
  // (which tolerates its own failures) report whatever the real problem is.
  if (entries === "unreadable") return true;
  if (entries === "absent") return false;
  if (entries.length === 0 || entries.includes(BUILD_OUTPUT_MARKER)) return true;

  const preview = entries.slice(0, REFUSAL_PREVIEW_LIMIT).join(", ");
  const more = entries.length > REFUSAL_PREVIEW_LIMIT
    ? `, and ${entries.length - REFUSAL_PREVIEW_LIMIT} more`
    : "";

  throw BUILD_FAILED.create({
    message: `Refusing to clear ${outputDir}: it holds files that no Veryfront build wrote ` +
      `(${preview}${more}). The build empties its output directory before writing, which ` +
      `would delete them. Move or delete that directory yourself, or build somewhere else ` +
      `with -o/--output or \`build: { outDir }\` in veryfront.config.ts.`,
  });
}

/** Entry names in `outputDir`, or why they could not be listed. */
async function readOutputDirectoryEntries(
  adapter: RuntimeAdapter,
  outputDir: string,
): Promise<string[] | "absent" | "unreadable"> {
  try {
    if (!(await adapter.fs.exists(outputDir))) return "absent";
    const names: string[] = [];
    for await (const entry of adapter.fs.readDir(outputDir)) names.push(entry.name);
    return names;
  } catch (error) {
    logger.debug("Could not inspect the build output directory", { outputDir, error });
    return "unreadable";
  }
}

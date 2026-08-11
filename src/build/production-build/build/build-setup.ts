import { serverLogger as logger } from "#veryfront/utils";
import { basename, isAbsolute, join, relative } from "#veryfront/compat/path/index.ts";
import { BUILD_FAILED, handleErrorWithFallback } from "#veryfront/errors";
import type { DirEntry, RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { cwd } from "#veryfront/platform/compat/process.ts";

/**
 * Directory every Veryfront build creates inside its output directory (below),
 * and so the marker that the output is a build artifact rather than a directory
 * the project keeps for itself. Only a directory of this name counts.
 */
const BUILD_OUTPUT_MARKER = "_veryfront";

/** Names listed in the refusal message before it stops enumerating. */
const REFUSAL_PREVIEW_LIMIT = 5;

/** Longest entry name, and output path, the refusal prints before truncating. */
const ENTRY_NAME_LIMIT = 60;
const OUTPUT_PATH_LIMIT = 120;

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
 * A directory holding a `_veryfront/` directory is a previous build's output:
 * this same function creates that entry before anything else is written, so
 * every directory the build has ever owned carries it — including one left by
 * an older release or by a build that failed halfway. Ownership is therefore
 * inherited without a new marker file, and upgrading does not turn every
 * existing `dist/` into an error. An empty directory has nothing to lose and
 * is cleared as before; an absent one needs no clearing at all.
 *
 * Ownership that cannot be established is not ownership: a listing that fails
 * — no permission, a transient filesystem error, a path that is a file rather
 * than a directory — proves nothing about what is there, so it refuses too.
 */
async function outputDirectoryNeedsClearing(
  adapter: RuntimeAdapter,
  outputDir: string,
): Promise<boolean> {
  const entries = await readOutputDirectoryEntries(adapter, outputDir);
  if (entries === "absent") return false;

  if (entries === "unreadable") {
    throw BUILD_FAILED.create({
      message: `Refusing to clear ${describeOutputDir(outputDir)}: its contents could not be ` +
        `listed, so there is no telling whether a Veryfront build wrote them. The build ` +
        `empties its output directory before writing, which would delete whatever is there. ` +
        `Check that it is a directory you can read, or build somewhere else with -o/--output ` +
        `or \`build: { outDir }\` in veryfront.config.ts.`,
    });
  }

  // A plain file or a symlink named `_veryfront` is not the directory this
  // function creates, so it does not make the output ours to delete.
  const owned = entries.some((entry) => entry.name === BUILD_OUTPUT_MARKER && entry.isDirectory);
  if (entries.length === 0 || owned) return true;

  const preview = entries
    .slice(0, REFUSAL_PREVIEW_LIMIT)
    .map((entry) => printable(entry.name, ENTRY_NAME_LIMIT))
    .join(", ");
  const more = entries.length > REFUSAL_PREVIEW_LIMIT
    ? `, and ${entries.length - REFUSAL_PREVIEW_LIMIT} more`
    : "";

  throw BUILD_FAILED.create({
    message: `Refusing to clear ${describeOutputDir(outputDir)}: it holds files that no ` +
      `Veryfront build wrote (${preview}${more}). The build empties its output directory ` +
      `before writing, which would delete them. Move or delete that directory yourself, or ` +
      `build somewhere else with -o/--output or \`build: { outDir }\` in veryfront.config.ts.`,
  });
}

/**
 * Name the output directory for a message a user reads.
 *
 * The CLI resolves the output to an absolute path before the build sees it, and
 * printing that leaks the machine's filesystem layout into human and `--json`
 * output alike. The project-relative path is what the developer configured and
 * all they need to act on; an output outside the project falls back to its last
 * segment rather than a chain of `../`.
 */
function describeOutputDir(outputDir: string): string {
  return printable(projectRelativePath(outputDir), OUTPUT_PATH_LIMIT);
}

function projectRelativePath(outputDir: string): string {
  try {
    const relativePath = relative(cwd(), outputDir);
    if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) {
      return basename(outputDir) || outputDir;
    }
    return relativePath;
  } catch {
    return basename(outputDir) || outputDir;
  }
}

/**
 * Render a filesystem name for a message a user reads.
 *
 * Entry names and configured paths are arbitrary filesystem input, so they can
 * carry control characters and terminal escape sequences that rewrite the
 * surrounding output instead of appearing in it. Those become `?`, the way `ls`
 * renders them, and a long name is cut so a single entry cannot push the rest
 * of the refusal — the part that says what to do — off the screen.
 */
function printable(value: string, limit: number): string {
  // deno-lint-ignore no-control-regex
  const escaped = value.replace(/[\u0000-\u001F\u007F-\u009F]/g, "?");
  return escaped.length > limit ? `${escaped.slice(0, limit)}…` : escaped;
}

/** Entries in `outputDir`, or why they could not be listed. */
async function readOutputDirectoryEntries(
  adapter: RuntimeAdapter,
  outputDir: string,
): Promise<DirEntry[] | "absent" | "unreadable"> {
  try {
    if (!(await adapter.fs.exists(outputDir))) return "absent";
    const entries: DirEntry[] = [];
    for await (const entry of adapter.fs.readDir(outputDir)) entries.push(entry);
    return entries;
  } catch (error) {
    logger.debug("Could not inspect the build output directory", { outputDir, error });
    return "unreadable";
  }
}

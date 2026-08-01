import { serverLogger as logger } from "#veryfront/utils";
import { join } from "#veryfront/compat/path/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { isAlreadyExistsError } from "#veryfront/platform/compat/fs.ts";
import { type BuildOutputOwnership, resolveBuildOutputOwnership } from "./build-publication.ts";

export type BuildDirectorySetupTarget =
  | { readonly dryRun: true }
  | { readonly dryRun: false; readonly output: BuildOutputOwnership };

const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;

function hasNoSymlinkSemantics(fileSystem: object): boolean {
  try {
    const descriptor = getOwnPropertyDescriptor(fileSystem, "symlinkSemantics");
    return descriptor !== undefined && "value" in descriptor && descriptor.value === "none";
  } catch {
    return false;
  }
}

async function createOrReuseDirectory(
  adapter: RuntimeAdapter,
  path: string,
): Promise<void> {
  try {
    await adapter.fs.mkdir(path);
  } catch (error) {
    if (!isAlreadyExistsError(error)) throw error;
    const lstat = adapter.fs.lstat?.bind(adapter.fs);
    if (!lstat && !hasNoSymlinkSemantics(adapter.fs)) {
      throw new TypeError(
        `Build output directory reuse requires non-following metadata: ${path}`,
      );
    }
    const info = lstat ? await lstat(path) : await adapter.fs.stat(path);
    if (info.isSymlink || !info.isDirectory || info.isFile) {
      throw new TypeError(`Build output path is not a directory: ${path}`);
    }
  }
}

export async function setupBuildDirectories(
  adapter: RuntimeAdapter,
  target: BuildDirectorySetupTarget,
): Promise<void> {
  logger.debug("Setting up build directories...");

  if (target.dryRun) {
    logger.debug("Build directories ready");
    return;
  }

  const outputDir = resolveBuildOutputOwnership(target.output, adapter.fs);

  const dirs = [
    join(outputDir, "_veryfront"),
    join(outputDir, "_veryfront/chunks"),
    join(outputDir, "_veryfront/data"),
    join(outputDir, "assets"),
  ];

  for (const dir of dirs) {
    await createOrReuseDirectory(adapter, dir);
  }

  logger.debug("Build directories ready");
}

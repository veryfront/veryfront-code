import { serverLogger as logger } from "#veryfront/utils";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { type BuildOutputOwnership, ensureOwnedBuildDescendant } from "./build-publication.ts";

export type BuildDirectorySetupTarget =
  | { readonly dryRun: true }
  | { readonly dryRun: false; readonly output: BuildOutputOwnership };

export async function setupBuildDirectories(
  adapter: RuntimeAdapter,
  target: BuildDirectorySetupTarget,
): Promise<void> {
  logger.debug("Setting up build directories...");

  if (target.dryRun) {
    logger.debug("Build directories ready");
    return;
  }

  const dirs = [
    "_veryfront",
    "_veryfront/chunks",
    "_veryfront/data",
    "assets",
  ];

  for (const dir of dirs) {
    await ensureOwnedBuildDescendant(target.output, adapter.fs, dir);
  }

  logger.debug("Build directories ready");
}

/**
 * One immutable project-source snapshot shared by request-time CSS import and
 * candidate scans. Provider-owned capabilities/results are admitted in the
 * HTML layer so request, rendering, and artifact-build paths share the same
 * boundary policy.
 */

import { collectCSSCandidateSourceFiles } from "#veryfront/html/styles-builder/css-source-collector.ts";
import {
  captureProjectStyleSourceSnapshot,
  createProjectStyleSourceSnapshot,
  type ProjectStyleSourceFileSnapshot,
  type ProjectStyleSourceSnapshot,
  snapshotProjectStyleSourceFiles,
} from "#veryfront/html/styles-builder/project-style-source-snapshot.ts";
import { createStyleScopeProfile } from "#veryfront/html/styles-builder/style-scope-profile.ts";
import { serverLogger } from "#veryfront/utils";
import type { HandlerContext } from "../types.ts";

const logger = serverLogger.component("styles-source-file-collector");

export type ProjectStyleSourceFile = ProjectStyleSourceFileSnapshot;
export type CollectedProjectStyleSourceSnapshot = ProjectStyleSourceSnapshot & {
  readonly files: readonly ProjectStyleSourceFileSnapshot[];
};

/** Capture one bounded project source snapshot for all request-time CSS scans. */
export async function collectProjectStyleSourceSnapshot(
  ctx: HandlerContext,
): Promise<CollectedProjectStyleSourceSnapshot> {
  const snapshotOptions = {
    adapter: ctx.adapter,
    projectDir: ctx.projectDir,
    config: ctx.config ?? {},
  };
  const providerSnapshot = await captureProjectStyleSourceSnapshot(snapshotOptions);
  if (providerSnapshot !== null && providerSnapshot.files !== null) {
    return providerSnapshot as CollectedProjectStyleSourceSnapshot;
  }

  logger.debug("No remote source-list capability; scanning the project filesystem", {
    projectDir: ctx.projectDir,
  });
  const localFiles = await collectCSSCandidateSourceFiles({
    projectDir: ctx.projectDir,
    patterns: ["**/*"],
    adapter: ctx.adapter,
    styleProfile: createStyleScopeProfile(ctx.config),
  });
  const files = await snapshotProjectStyleSourceFiles(localFiles, snapshotOptions);
  return createProjectStyleSourceSnapshot(
    "local",
    providerSnapshot?.contentContext ?? null,
    files,
    providerSnapshot?.projectUpdatedAt,
  ) as CollectedProjectStyleSourceSnapshot;
}

/** Compatibility facade for callers that only need the admitted file array. */
export async function collectProjectStyleSourceFiles(
  ctx: HandlerContext,
): Promise<readonly ProjectStyleSourceFile[]> {
  return (await collectProjectStyleSourceSnapshot(ctx)).files;
}

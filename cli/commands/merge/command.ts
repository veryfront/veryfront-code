/**
 * Merge command - Merge a branch into main (or another branch)
 *
 * Looks up a branch by name and merges it into the target branch
 * (defaults to main). Supports dry-run to preview merge changes.
 *
 * @module cli/commands/merge
 */

import { defineSchema, lazySchema } from "veryfront/schemas";
import type { InferSchema } from "veryfront/extensions/schema";
import { cliLogger } from "#cli/utils";
import { cwd } from "veryfront/platform";
import { type ApiClient, createApiClient, resolveConfigWithAuth } from "#cli/shared/config";
import { CommonArgs, createArgParser } from "#cli/shared/args";
import { confirmPrompt, logInfo, logSuccess } from "#cli/utils";
import { createSpinner } from "#cli/ui";
import { BRANCH_NOT_FOUND } from "veryfront/errors";
import {
  computeSourceDigest,
  normalizeControlPlane,
  readPushReceipt,
  writePushReceipt,
} from "../../shared/deployment-provenance.ts";
import { listAllFiles, type PullSource } from "../pull/command.ts";
import {
  computeContentDigest,
  readSyncTarget,
  type SyncFileSnapshot,
  writeSyncTarget,
} from "../../sync/state.ts";

/**
 * Schema factory for merge command arguments
 */
export const getMergeArgsSchema = defineSchema((v) =>
  v.object({
    branch: v.string().min(1, "Branch name is required"),
    into: v.string().min(1).optional(),
    dryRun: v.boolean().default(false),
    force: v.boolean().default(false),
  })
);

export const MergeArgsSchema = lazySchema(getMergeArgsSchema);

/**
 * Merge command options (inferred from schema)
 */
export type MergeOptions = InferSchema<ReturnType<typeof getMergeArgsSchema>>;

/**
 * Parse CLI arguments into validated MergeOptions
 */
export const parseMergeArgs = createArgParser(MergeArgsSchema, {
  branch: { keys: [], type: "string", positional: 0 },
  into: CommonArgs.into,
  dryRun: CommonArgs.dryRun,
  force: CommonArgs.force,
});

/**
 * Branch from the API
 */
interface Branch {
  id: string;
  name: string;
  project_id: string;
}

/**
 * Merge response from API
 */
interface MergeResponse {
  success: boolean;
  branch: Branch;
  merged_documents: number;
  added_documents: number;
  deleted_documents: number;
  auto_merged_documents: number;
}

/**
 * Merge preview diff item
 */
interface MergePreviewDiff {
  file_path: string;
  has_conflicts: boolean;
}

/**
 * List branches response from API
 */
interface ListBranchesResponse {
  data: Branch[];
  page_info?: {
    next?: string;
  };
}

/**
 * Look up a branch by name (with pagination support)
 */
export async function getBranchByName(
  client: ApiClient,
  projectSlug: string,
  name: string,
): Promise<Branch | null> {
  let cursor: string | undefined;

  do {
    const params: Record<string, string> = {
      search: name,
      limit: "100",
      ...(cursor ? { cursor } : {}),
    };

    const response = await client.get<ListBranchesResponse>(
      `/projects/${encodeURIComponent(projectSlug)}/branches`,
      params,
    );

    const found = response.data.find((b) => b.name === name);
    if (found) return found;

    cursor = response.page_info?.next;
  } while (cursor);

  return null;
}

/**
 * Merge a branch into target (or main)
 */
export function mergeBranch(
  client: ApiClient,
  projectSlug: string,
  branchId: string,
  targetBranchId?: string,
): Promise<MergeResponse> {
  return client.post<MergeResponse>(
    `/projects/${encodeURIComponent(projectSlug)}/branches/${encodeURIComponent(branchId)}/merge`,
    { target_branch_id: targetBranchId ?? null },
  );
}

/**
 * Get merge preview
 */
export function getMergePreview(
  client: ApiClient,
  projectSlug: string,
  branchId: string,
  targetBranchId?: string,
): Promise<MergePreviewDiff[]> {
  const params: Record<string, string> = targetBranchId ? { target_branch_id: targetBranchId } : {};
  return client
    .get<{ diffs: MergePreviewDiff[] }>(
      `/projects/${encodeURIComponent(projectSlug)}/branches/${
        encodeURIComponent(branchId)
      }/merge-preview`,
      params,
    )
    .then((response) => response.diffs);
}

/**
 * Record a merge in this directory's push receipt.
 *
 * `veryfront deploy` promotes only the branch the receipt names, so after
 * `veryfront merge new-headline` it refused main even though main held the
 * merged change (veryfront/veryfront-issue-inbox#4363). The receipt moves to
 * the target only when the target's tree is now exactly the source the receipt
 * describes, which keeps its proof intact: the deploy still verifies the
 * release against that digest and this directory against its local digest. A
 * target that also holds changes this directory never pushed keeps the receipt
 * as it was, and the deploy refuses with the push that fixes it.
 */
/**
 * Whether the receipt was written for the project this merge ran against.
 *
 * `VERYFRONT_PROJECT_ID` puts the project id where the slug usually goes,
 * while a push records the resolved slug and id, so either may match.
 */
function receiptNamesProject(
  receipt: { projectId: string; projectSlug: string },
  project: { projectSlug: string; projectId?: string },
): boolean {
  if (project.projectId !== undefined) return receipt.projectId === project.projectId;
  return receipt.projectSlug === project.projectSlug || receipt.projectId === project.projectSlug;
}

export async function recordMergeInPushReceipt(input: {
  client: ApiClient;
  controlPlane: string;
  /** The reference the API calls use: a slug, or a project id when one selects it. */
  projectSlug: string;
  /** The resolved project id, when the configuration knows it. */
  projectId?: string;
  projectDir: string;
  sourceBranch: string;
  targetBranch: string;
}): Promise<boolean> {
  const receipt = await readPushReceipt(input.projectDir);
  if (
    !receipt ||
    receipt.branch !== input.sourceBranch ||
    !receiptNamesProject(receipt, input) ||
    normalizeControlPlane(receipt.controlPlane) !== normalizeControlPlane(input.controlPlane)
  ) {
    return false;
  }

  const target: PullSource = input.targetBranch === "main"
    ? { type: "main" }
    : { type: "branch", name: input.targetBranch };
  const files = await listAllFiles(input.client, input.projectSlug, target);
  if (files.some((file) => typeof file.content !== "string")) return false;
  const targetDigest = await computeSourceDigest(
    files.map(({ path, content }) => ({ path, content })),
  );
  if (targetDigest !== receipt.sourceDigest) return false;

  // The push recorded its conflict baseline for the source branch only. The
  // target now holds the same files, so it inherits that baseline's paths with
  // the target's own digests and versions. Otherwise the next push of a local
  // edit to the target compares against its pre-merge baseline and conflicts.
  const scope = { controlPlane: receipt.controlPlane, projectId: receipt.projectId };
  const sourceBaseline = await readSyncTarget(input.projectDir, {
    ...scope,
    branch: input.sourceBranch,
  });
  if (sourceBaseline) {
    const targetFiles = new Map(files.map((file) => [file.path, file]));
    const baseline: Record<string, SyncFileSnapshot> = {};
    for (const path of Object.keys(sourceBaseline.files)) {
      const file = targetFiles.get(path);
      if (!file) continue;
      baseline[path] = {
        digest: await computeContentDigest(file.content),
        ...(file.version_id ? { versionId: file.version_id } : {}),
      };
    }
    await writeSyncTarget(input.projectDir, {
      ...scope,
      projectSlug: receipt.projectSlug,
      branch: input.targetBranch,
      files: baseline,
    });
  }

  await writePushReceipt(input.projectDir, { ...receipt, branch: input.targetBranch });
  return true;
}

/**
 * Merge a branch into main (or another branch)
 */
export async function mergeCommand(options: MergeOptions): Promise<void> {
  const { branch, into, dryRun = false, force = false } = options;

  let spinner = createSpinner("Resolving configuration...");

  const projectDir = cwd();
  const config = await resolveConfigWithAuth(projectDir);
  const client = createApiClient(config);

  spinner.update(`Looking up branch "${branch}"...`);

  const sourceBranch = await getBranchByName(client, config.projectSlug, branch);
  if (!sourceBranch) {
    spinner.stop();
    throw BRANCH_NOT_FOUND.create({ detail: `Branch "${branch}" not found` });
  }

  const targetName = into ?? "main";

  let targetBranchId: string | undefined;
  if (into && into !== "main") {
    spinner.update(`Looking up target branch "${into}"...`);
    const targetBranch = await getBranchByName(client, config.projectSlug, into);
    if (!targetBranch) {
      spinner.stop();
      throw BRANCH_NOT_FOUND.create({ detail: `Target branch "${into}" not found` });
    }
    targetBranchId = targetBranch.id;
  }

  if (dryRun) {
    spinner.update("Fetching merge preview...");
    const diffs = await getMergePreview(
      client,
      config.projectSlug,
      sourceBranch.id,
      targetBranchId,
    );
    spinner.stop();

    const conflicts = diffs.filter((d) => d.has_conflicts);

    logInfo(`Would merge ${diffs.length} files from "${branch}" into ${targetName}`);
    if (conflicts.length > 0) {
      cliLogger.warn(`  ${conflicts.length} file(s) have conflicts`);
      for (const conflict of conflicts) {
        cliLogger.warn(`    - ${conflict.file_path}`);
      }
    }
    return;
  }

  spinner.stop();

  if (!force) {
    const confirmed = await confirmPrompt(`Merge branch "${branch}" into ${targetName}?`, true);
    if (!confirmed) {
      cliLogger.info("Merge cancelled.");
      return;
    }
  }

  spinner = createSpinner(`Merging "${branch}" into ${targetName}...`);

  const result = await mergeBranch(client, config.projectSlug, sourceBranch.id, targetBranchId);

  // The merge already happened, so a receipt that cannot be updated is not a
  // merge failure: it stays as it was, and the deploy names the push to run.
  try {
    await recordMergeInPushReceipt({
      client,
      controlPlane: config.apiUrl,
      projectSlug: config.projectSlug,
      projectId: config.projectId,
      projectDir,
      sourceBranch: branch,
      targetBranch: targetName,
    });
  } catch (error) {
    cliLogger.debug("Could not record the merge in the push receipt", error);
  }

  spinner.stop();

  logSuccess(`Merged "${branch}" into ${targetName}`);
  logInfo(
    `  ${result.merged_documents} merged, ${result.added_documents} added, ${result.deleted_documents} deleted`,
  );
}

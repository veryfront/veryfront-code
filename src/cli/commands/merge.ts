/**
 * Merge command - Merge a branch into main (or another branch)
 *
 * Looks up a branch by name and merges it into the target branch
 * (defaults to main). Supports dry-run to preview merge changes.
 *
 * @module cli/commands/merge
 */

import { z } from "zod";
import { cliLogger } from "@veryfront/utils";
import { cwd } from "@veryfront/platform/compat/process.ts";
import { type ApiClient, createApiClient, resolveConfig } from "../shared/config.ts";
import { confirmPrompt, createSpinner, logInfo, logSuccess } from "../utils/index.ts";
import type { ParsedArgs } from "../index/types.ts";

/**
 * Zod schema for merge command arguments
 */
export const MergeArgsSchema = z.object({
  branch: z.string().min(1, "Branch name is required"),
  into: z.string().min(1).optional(),
  dryRun: z.boolean().default(false),
  force: z.boolean().default(false),
});

/**
 * Merge command options (inferred from schema)
 */
export type MergeOptions = z.infer<typeof MergeArgsSchema>;

/**
 * Parse CLI arguments into validated MergeOptions
 */
export function parseMergeArgs(args: ParsedArgs): z.SafeParseReturnType<unknown, MergeOptions> {
  const rawArgs = {
    branch: args._.length > 1 ? String(args._[1]) : undefined,
    into: args.into ? String(args.into) : undefined,
    dryRun: Boolean(args["dry-run"]),
    force: Boolean(args.force) || Boolean(args.f),
  };
  return MergeArgsSchema.safeParse(rawArgs);
}

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
  path: string;
  has_conflict: boolean;
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
    const params: Record<string, string> = { search: name, limit: "100" };
    if (cursor) params.cursor = cursor;

    const response = await client.get<ListBranchesResponse>(
      `/projects/${projectSlug}/branches`,
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
export async function mergeBranch(
  client: ApiClient,
  projectSlug: string,
  branchId: string,
  targetBranchId?: string,
): Promise<MergeResponse> {
  return await client.post<MergeResponse>(
    `/projects/${projectSlug}/branches/${branchId}/merge`,
    { target_branch_id: targetBranchId || null },
  );
}

/**
 * Get merge preview
 */
async function getMergePreview(
  client: ApiClient,
  projectSlug: string,
  branchId: string,
  targetBranchId?: string,
): Promise<MergePreviewDiff[]> {
  const params: Record<string, string> = {};
  if (targetBranchId) {
    params.target_branch_id = targetBranchId;
  }
  const response = await client.get<{ diffs: MergePreviewDiff[] }>(
    `/projects/${projectSlug}/branches/${branchId}/merge-preview`,
    params,
  );
  return response.diffs;
}

/**
 * Merge a branch into main (or another branch)
 */
export async function mergeCommand(options: MergeOptions): Promise<void> {
  const { branch, into, dryRun = false, force = false } = options;

  const spinner = createSpinner("Resolving configuration...");
  spinner.start();

  const config = await resolveConfig(cwd());
  const client = createApiClient(config);

  spinner.update(`Looking up branch "${branch}"...`);

  // Look up source branch
  const sourceBranch = await getBranchByName(client, config.projectSlug, branch);
  if (!sourceBranch) {
    spinner.stop();
    throw new Error(`Branch "${branch}" not found`);
  }

  // Look up target branch if specified
  let targetBranchId: string | undefined;
  if (into && into !== "main") {
    spinner.update(`Looking up target branch "${into}"...`);
    const targetBranch = await getBranchByName(client, config.projectSlug, into);
    if (!targetBranch) {
      spinner.stop();
      throw new Error(`Target branch "${into}" not found`);
    }
    targetBranchId = targetBranch.id;
  }

  const targetName = into || "main";

  // Dry run: fetch merge preview
  if (dryRun) {
    spinner.update("Fetching merge preview...");
    const diffs = await getMergePreview(
      client,
      config.projectSlug,
      sourceBranch.id,
      targetBranchId,
    );
    spinner.stop();

    const conflicts = diffs.filter((d) => d.has_conflict);

    logInfo(`Would merge ${diffs.length} files from "${branch}" into ${targetName}`);
    if (conflicts.length > 0) {
      cliLogger.warn(`  ${conflicts.length} file(s) have conflicts`);
      for (const conflict of conflicts) {
        cliLogger.warn(`    - ${conflict.path}`);
      }
    }
    return;
  }

  spinner.stop();

  // Confirm
  if (!force) {
    const confirmed = await confirmPrompt(
      `Merge branch "${branch}" into ${targetName}?`,
      true,
    );
    if (!confirmed) {
      cliLogger.info("Merge cancelled.");
      return;
    }
  }

  // Execute merge
  spinner.start();
  spinner.update(`Merging "${branch}" into ${targetName}...`);

  const result = await mergeBranch(client, config.projectSlug, sourceBranch.id, targetBranchId);

  spinner.stop();

  logSuccess(`Merged "${branch}" into ${targetName}`);
  logInfo(
    `  ${result.merged_documents} merged, ${result.added_documents} added, ${result.deleted_documents} deleted`,
  );
}

/**
 * Merge command - Merge a branch into main (or another branch)
 *
 * Looks up a branch by name and merges it into the target branch
 * (defaults to main). Supports dry-run to preview merge changes.
 *
 * @module cli/commands/merge
 */
import { z } from "zod";
import { cliLogger } from "../../utils/index.js";
import { cwd } from "../../platform/compat/process.js";
import { createApiClient, resolveConfig } from "../shared/config.js";
import { confirmPrompt, createSpinner, logInfo, logSuccess } from "../utils/index.js";
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
 * Parse CLI arguments into validated MergeOptions
 */
export function parseMergeArgs(args) {
    return MergeArgsSchema.safeParse({
        branch: args._.length > 1 ? String(args._[1]) : undefined,
        into: args.into ? String(args.into) : undefined,
        dryRun: Boolean(args["dry-run"]),
        force: Boolean(args.force) || Boolean(args.f),
    });
}
/**
 * Look up a branch by name (with pagination support)
 */
export async function getBranchByName(client, projectSlug, name) {
    let cursor;
    do {
        const params = {
            search: name,
            limit: "100",
            ...(cursor ? { cursor } : {}),
        };
        const response = await client.get(`/projects/${projectSlug}/branches`, params);
        const found = response.data.find((b) => b.name === name);
        if (found)
            return found;
        cursor = response.page_info?.next;
    } while (cursor);
    return null;
}
/**
 * Merge a branch into target (or main)
 */
export function mergeBranch(client, projectSlug, branchId, targetBranchId) {
    return client.post(`/projects/${projectSlug}/branches/${branchId}/merge`, {
        target_branch_id: targetBranchId ?? null,
    });
}
/**
 * Get merge preview
 */
function getMergePreview(client, projectSlug, branchId, targetBranchId) {
    const params = targetBranchId ? { target_branch_id: targetBranchId } : {};
    return client
        .get(`/projects/${projectSlug}/branches/${branchId}/merge-preview`, params)
        .then((response) => response.diffs);
}
/**
 * Merge a branch into main (or another branch)
 */
export async function mergeCommand(options) {
    const { branch, into, dryRun = false, force = false } = options;
    const spinner = createSpinner("Resolving configuration...");
    spinner.start();
    const config = await resolveConfig(cwd());
    const client = createApiClient(config);
    spinner.update(`Looking up branch "${branch}"...`);
    const sourceBranch = await getBranchByName(client, config.projectSlug, branch);
    if (!sourceBranch) {
        spinner.stop();
        throw new Error(`Branch "${branch}" not found`);
    }
    const targetName = into || "main";
    let targetBranchId;
    if (into && into !== "main") {
        spinner.update(`Looking up target branch "${into}"...`);
        const targetBranch = await getBranchByName(client, config.projectSlug, into);
        if (!targetBranch) {
            spinner.stop();
            throw new Error(`Target branch "${into}" not found`);
        }
        targetBranchId = targetBranch.id;
    }
    if (dryRun) {
        spinner.update("Fetching merge preview...");
        const diffs = await getMergePreview(client, config.projectSlug, sourceBranch.id, targetBranchId);
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
    if (!force) {
        const confirmed = await confirmPrompt(`Merge branch "${branch}" into ${targetName}?`, true);
        if (!confirmed) {
            cliLogger.info("Merge cancelled.");
            return;
        }
    }
    spinner.start();
    spinner.update(`Merging "${branch}" into ${targetName}...`);
    const result = await mergeBranch(client, config.projectSlug, sourceBranch.id, targetBranchId);
    spinner.stop();
    logSuccess(`Merged "${branch}" into ${targetName}`);
    logInfo(`  ${result.merged_documents} merged, ${result.added_documents} added, ${result.deleted_documents} deleted`);
}

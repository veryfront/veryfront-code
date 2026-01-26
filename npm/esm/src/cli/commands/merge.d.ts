/**
 * Merge command - Merge a branch into main (or another branch)
 *
 * Looks up a branch by name and merges it into the target branch
 * (defaults to main). Supports dry-run to preview merge changes.
 *
 * @module cli/commands/merge
 */
import { z } from "zod";
import { type ApiClient } from "../shared/config.js";
import type { ParsedArgs } from "../index/types.js";
/**
 * Zod schema for merge command arguments
 */
export declare const MergeArgsSchema: z.ZodObject<{
    branch: z.ZodString;
    into: z.ZodOptional<z.ZodString>;
    dryRun: z.ZodDefault<z.ZodBoolean>;
    force: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    force: boolean;
    branch: string;
    dryRun: boolean;
    into?: string | undefined;
}, {
    branch: string;
    force?: boolean | undefined;
    dryRun?: boolean | undefined;
    into?: string | undefined;
}>;
/**
 * Merge command options (inferred from schema)
 */
export type MergeOptions = z.infer<typeof MergeArgsSchema>;
/**
 * Parse CLI arguments into validated MergeOptions
 */
export declare function parseMergeArgs(args: ParsedArgs): z.SafeParseReturnType<unknown, MergeOptions>;
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
 * Look up a branch by name (with pagination support)
 */
export declare function getBranchByName(client: ApiClient, projectSlug: string, name: string): Promise<Branch | null>;
/**
 * Merge a branch into target (or main)
 */
export declare function mergeBranch(client: ApiClient, projectSlug: string, branchId: string, targetBranchId?: string): Promise<MergeResponse>;
/**
 * Merge a branch into main (or another branch)
 */
export declare function mergeCommand(options: MergeOptions): Promise<void>;
export {};
//# sourceMappingURL=merge.d.ts.map
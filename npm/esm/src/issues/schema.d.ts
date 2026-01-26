/**
 * Zod schemas for issue validation and parsing
 *
 * @module issues/schema
 */
import { z } from "zod";
import type { IssueMetadata, IssueState } from "./types.js";
/**
 * Valid issue ID prefixes
 */
export declare const ISSUE_PREFIXES: readonly ["ISSUE", "TASK", "PLAN"];
export type IssuePrefix = (typeof ISSUE_PREFIXES)[number];
/**
 * Regex pattern for valid issue IDs
 * Format: PREFIX-NNN (e.g., ISSUE-001, TASK-042, PLAN-123)
 */
export declare const ISSUE_ID_PATTERN: RegExp;
/**
 * Schema for issue state
 */
export declare const issueStateSchema: z.ZodEnum<["open", "closed"]>;
/**
 * Schema for issue ID validation
 */
export declare const issueIdSchema: z.ZodString;
/**
 * Schema for labels (colon syntax supported)
 */
export declare const labelSchema: z.ZodString;
/**
 * Schema for ISO 8601 date strings
 */
export declare const isoDateSchema: z.ZodEffects<z.ZodString, string, string>;
/**
 * Schema for issue metadata (YAML frontmatter)
 */
export declare const issueMetadataSchema: z.ZodObject<{
    id: z.ZodString;
    title: z.ZodString;
    state: z.ZodEnum<["open", "closed"]>;
    labels: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    milestone: z.ZodOptional<z.ZodString>;
    assignees: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    created_at: z.ZodEffects<z.ZodString, string, string>;
    updated_at: z.ZodEffects<z.ZodString, string, string>;
}, "strip", z.ZodTypeAny, {
    title: string;
    id: string;
    created_at: string;
    updated_at: string;
    state: "open" | "closed";
    labels: string[];
    assignees: string[];
    milestone?: string | undefined;
}, {
    title: string;
    id: string;
    created_at: string;
    updated_at: string;
    state: "open" | "closed";
    labels?: string[] | undefined;
    milestone?: string | undefined;
    assignees?: string[] | undefined;
}>;
/**
 * Schema for creating issues
 */
export declare const createIssueSchema: z.ZodObject<{
    title: z.ZodString;
    body: z.ZodOptional<z.ZodString>;
    labels: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    milestone: z.ZodOptional<z.ZodString>;
    assignees: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    prefix: z.ZodDefault<z.ZodOptional<z.ZodEnum<["ISSUE", "TASK", "PLAN"]>>>;
}, "strip", z.ZodTypeAny, {
    title: string;
    prefix: "ISSUE" | "TASK" | "PLAN";
    body?: string | undefined;
    labels?: string[] | undefined;
    milestone?: string | undefined;
    assignees?: string[] | undefined;
}, {
    title: string;
    prefix?: "ISSUE" | "TASK" | "PLAN" | undefined;
    body?: string | undefined;
    labels?: string[] | undefined;
    milestone?: string | undefined;
    assignees?: string[] | undefined;
}>;
/**
 * Schema for updating issues
 */
export declare const updateIssueSchema: z.ZodObject<{
    title: z.ZodOptional<z.ZodString>;
    body: z.ZodOptional<z.ZodString>;
    state: z.ZodOptional<z.ZodEnum<["open", "closed"]>>;
    labels: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    milestone: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    assignees: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    title?: string | undefined;
    body?: string | undefined;
    state?: "open" | "closed" | undefined;
    labels?: string[] | undefined;
    milestone?: string | null | undefined;
    assignees?: string[] | undefined;
}, {
    title?: string | undefined;
    body?: string | undefined;
    state?: "open" | "closed" | undefined;
    labels?: string[] | undefined;
    milestone?: string | null | undefined;
    assignees?: string[] | undefined;
}>;
/**
 * Schema for listing issues
 */
export declare const listIssuesSchema: z.ZodObject<{
    state: z.ZodOptional<z.ZodEnum<["open", "closed"]>>;
    labels: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    milestone: z.ZodOptional<z.ZodString>;
    assignee: z.ZodOptional<z.ZodString>;
    prefix: z.ZodOptional<z.ZodEnum<["ISSUE", "TASK", "PLAN"]>>;
    sortBy: z.ZodDefault<z.ZodOptional<z.ZodEnum<["created_at", "updated_at", "id"]>>>;
    sortDirection: z.ZodDefault<z.ZodOptional<z.ZodEnum<["asc", "desc"]>>>;
    limit: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    sortBy: "id" | "created_at" | "updated_at";
    sortDirection: "asc" | "desc";
    prefix?: "ISSUE" | "TASK" | "PLAN" | undefined;
    limit?: number | undefined;
    state?: "open" | "closed" | undefined;
    labels?: string[] | undefined;
    milestone?: string | undefined;
    assignee?: string | undefined;
}, {
    prefix?: "ISSUE" | "TASK" | "PLAN" | undefined;
    limit?: number | undefined;
    sortBy?: "id" | "created_at" | "updated_at" | undefined;
    state?: "open" | "closed" | undefined;
    labels?: string[] | undefined;
    milestone?: string | undefined;
    assignee?: string | undefined;
    sortDirection?: "asc" | "desc" | undefined;
}>;
/**
 * Validate issue metadata
 */
export declare function validateMetadata(data: unknown): IssueMetadata;
/**
 * Check if a string is a valid issue ID
 */
export declare function isValidIssueId(id: string): boolean;
/**
 * Parse issue ID into prefix and number
 */
export declare function parseIssueId(id: string): {
    prefix: IssuePrefix;
    number: number;
} | null;
/**
 * Generate next issue ID for a given prefix
 */
export declare function generateIssueId(prefix: IssuePrefix, existingIds: string[]): string;
/**
 * Parse state from string, with aliases
 */
export declare function parseState(value: string): IssueState | null;
//# sourceMappingURL=schema.d.ts.map
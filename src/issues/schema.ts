/**
 * Zod schemas for issue validation and parsing
 *
 * @module issues/schema
 */

import { z } from "zod";
import type { IssueMetadata, IssueState } from "./types.ts";

/**
 * Valid issue ID prefixes
 */
export const ISSUE_PREFIXES = ["ISSUE", "TASK", "PLAN"] as const;
export type IssuePrefix = (typeof ISSUE_PREFIXES)[number];

/**
 * Regex pattern for valid issue IDs
 * Format: PREFIX-NNN (e.g., ISSUE-001, TASK-042, PLAN-123)
 */
export const ISSUE_ID_PATTERN = /^(ISSUE|TASK|PLAN)-(\d{3,})$/;

/**
 * Schema for issue state
 */
export const issueStateSchema = z.enum(["open", "closed"]);

/**
 * Schema for issue ID validation
 */
export const issueIdSchema = z
  .string()
  .regex(ISSUE_ID_PATTERN, "Issue ID must be in format PREFIX-NNN (e.g., ISSUE-001, TASK-042)");

/**
 * Schema for labels (colon syntax supported)
 */
export const labelSchema = z.string().min(1).max(50);

/**
 * Schema for ISO 8601 date strings
 */
export const isoDateSchema = z
  .string()
  .refine((val) => !Number.isNaN(Date.parse(val)), "Must be a valid ISO 8601 date string");

/**
 * Schema for issue metadata (YAML frontmatter)
 */
export const issueMetadataSchema = z.object({
  id: issueIdSchema,
  title: z.string().min(1).max(500),
  state: issueStateSchema,
  labels: z.array(labelSchema).default([]),
  milestone: z.string().optional(),
  assignees: z.array(z.string()).default([]),
  created_at: isoDateSchema,
  updated_at: isoDateSchema,
});

/**
 * Schema for creating issues
 */
export const createIssueSchema = z.object({
  title: z.string().min(1).max(500),
  body: z.string().optional(),
  labels: z.array(labelSchema).optional(),
  milestone: z.string().optional(),
  assignees: z.array(z.string()).optional(),
  prefix: z.enum(ISSUE_PREFIXES).optional().default("ISSUE"),
});

/**
 * Schema for updating issues
 */
export const updateIssueSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  body: z.string().optional(),
  state: issueStateSchema.optional(),
  labels: z.array(labelSchema).optional(),
  milestone: z.string().nullable().optional(),
  assignees: z.array(z.string()).optional(),
});

/**
 * Schema for listing issues
 */
export const listIssuesSchema = z.object({
  state: issueStateSchema.optional(),
  labels: z.array(labelSchema).optional(),
  milestone: z.string().optional(),
  assignee: z.string().optional(),
  prefix: z.enum(ISSUE_PREFIXES).optional(),
  sortBy: z.enum(["created_at", "updated_at", "id"]).optional().default("created_at"),
  sortDirection: z.enum(["asc", "desc"]).optional().default("desc"),
  limit: z.number().positive().optional(),
});

/**
 * Validate issue metadata
 */
export function validateMetadata(data: unknown): IssueMetadata {
  return issueMetadataSchema.parse(data);
}

/**
 * Check if a string is a valid issue ID
 */
export function isValidIssueId(id: string): boolean {
  return ISSUE_ID_PATTERN.test(id);
}

/**
 * Parse issue ID into prefix and number
 */
export function parseIssueId(id: string): { prefix: IssuePrefix; number: number } | null {
  const match = ISSUE_ID_PATTERN.exec(id);
  if (!match || !match[1] || !match[2]) return null;

  return {
    prefix: match[1] as IssuePrefix,
    number: Number.parseInt(match[2], 10),
  };
}

/**
 * Generate next issue ID for a given prefix
 */
export function generateIssueId(prefix: IssuePrefix, existingIds: string[]): string {
  const numbers = existingIds
    .filter((id) => id.startsWith(`${prefix}-`))
    .map((id) => parseIssueId(id)?.number)
    .filter((n): n is number => typeof n === "number" && n > 0);

  const nextNumber = (numbers.length ? Math.max(...numbers) : 0) + 1;
  return `${prefix}-${nextNumber.toString().padStart(3, "0")}`;
}

/**
 * Parse state from string, with aliases
 */
export function parseState(value: string): IssueState | null {
  const normalized = value.toLowerCase().trim();

  const aliases: Record<string, IssueState> = {
    open: "open",
    opened: "open",
    active: "open",
    closed: "closed",
    close: "closed",
    done: "closed",
    resolved: "closed",
    completed: "closed",
  };

  return aliases[normalized] ?? null;
}

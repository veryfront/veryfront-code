/**********************************
 * Zod schemas for issue validation and parsing
 *
 * @module issues/schema
 **********************************/

import { z } from "zod";
import type { IssueMetadata, IssueState } from "./types.ts";

export const ISSUE_PREFIXES = ["ISSUE", "TASK", "PLAN"] as const;
export type IssuePrefix = (typeof ISSUE_PREFIXES)[number];

export const ISSUE_ID_PATTERN = /^(ISSUE|TASK|PLAN)-(\d{3,})$/;

export const issueStateSchema = z.enum(["open", "closed"]);

export const issueIdSchema = z
  .string()
  .regex(ISSUE_ID_PATTERN, "Issue ID must be in format PREFIX-NNN (e.g., ISSUE-001, TASK-042)");

export const labelSchema = z.string().min(1).max(50);

export const isoDateSchema = z
  .string()
  .refine((val) => !Number.isNaN(Date.parse(val)), "Must be a valid ISO 8601 date string");

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

export const createIssueSchema = z.object({
  title: z.string().min(1).max(500),
  body: z.string().optional(),
  labels: z.array(labelSchema).optional(),
  milestone: z.string().optional(),
  assignees: z.array(z.string()).optional(),
  prefix: z.enum(ISSUE_PREFIXES).optional().default("ISSUE"),
});

export const updateIssueSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  body: z.string().optional(),
  state: issueStateSchema.optional(),
  labels: z.array(labelSchema).optional(),
  milestone: z.string().nullable().optional(),
  assignees: z.array(z.string()).optional(),
});

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

export function validateMetadata(data: unknown): IssueMetadata {
  return issueMetadataSchema.parse(data);
}

export function isValidIssueId(id: string): boolean {
  return ISSUE_ID_PATTERN.test(id);
}

export function parseIssueId(id: string): { prefix: IssuePrefix; number: number } | null {
  const match = ISSUE_ID_PATTERN.exec(id);
  if (!match || !match[1] || !match[2]) return null;

  return {
    prefix: match[1] as IssuePrefix,
    number: Number.parseInt(match[2], 10),
  };
}

export function generateIssueId(prefix: IssuePrefix, existingIds: string[]): string {
  const numbers = existingIds
    .filter((id) => id.startsWith(`${prefix}-`))
    .map((id) => parseIssueId(id)?.number)
    .filter((n): n is number => typeof n === "number" && n > 0);

  const nextNumber = (numbers.length ? Math.max(...numbers) : 0) + 1;
  return `${prefix}-${nextNumber.toString().padStart(3, "0")}`;
}

const STATE_ALIASES: Record<string, IssueState> = {
  open: "open",
  opened: "open",
  active: "open",
  closed: "closed",
  close: "closed",
  done: "closed",
  resolved: "closed",
  completed: "closed",
};

export function parseState(value: string): IssueState | null {
  const normalized = value.toLowerCase().trim();
  return STATE_ALIASES[normalized] ?? null;
}

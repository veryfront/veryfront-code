import { defineSchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";

export const ISSUE_PREFIXES = ["ISSUE", "TASK", "PLAN"] as const;
const ISSUE_ID_BODY = `(${ISSUE_PREFIXES.join("|")})-(\\d{3,})`;

export const ISSUE_ID_PATTERN = new RegExp(`^${ISSUE_ID_BODY}$`);

export const getIssueStateSchema = defineSchema((v) => v.enum(["open", "closed"]));
export const issueStateSchema = getIssueStateSchema();

export const getIssuePrefixSchema = defineSchema((v) => v.enum(ISSUE_PREFIXES));
export const issuePrefixSchema = getIssuePrefixSchema();

export const getIssueIdSchema = defineSchema((v) =>
  v.string()
    .regex(ISSUE_ID_PATTERN, "Issue ID must be in format PREFIX-NNN (e.g., ISSUE-001, TASK-042)")
);
export const issueIdSchema = getIssueIdSchema();

export const getLabelSchema = defineSchema((v) => v.string().min(1).max(50));
export const labelSchema = getLabelSchema();

export const getIsoDateSchema = defineSchema((v) =>
  v.string()
    .refine((val: string) => !Number.isNaN(Date.parse(val)), "Must be a valid ISO 8601 date string")
);
export const isoDateSchema = getIsoDateSchema();

export const getIssueMetadataSchema = defineSchema((v) =>
  v.object({
    id: getIssueIdSchema(),
    title: v.string().min(1).max(500),
    state: getIssueStateSchema(),
    labels: v.array(getLabelSchema()).default([]),
    milestone: v.string().optional(),
    assignees: v.array(v.string()).default([]),
    created_at: getIsoDateSchema(),
    updated_at: getIsoDateSchema(),
  })
);
export const issueMetadataSchema = getIssueMetadataSchema();

export const getIssueSchema = defineSchema((v) =>
  v.object({
    metadata: getIssueMetadataSchema(),
    body: v.string(),
    path: v.string(),
  })
);
export const issueSchema = getIssueSchema();

export const getCreateIssueSchema = defineSchema((v) =>
  v.object({
    title: v.string().min(1).max(500),
    body: v.string().optional(),
    labels: v.array(getLabelSchema()).optional(),
    milestone: v.string().optional(),
    assignees: v.array(v.string()).optional(),
    prefix: getIssuePrefixSchema().optional(),
  })
);
export const createIssueSchema = getCreateIssueSchema();

export const getUpdateIssueSchema = defineSchema((v) =>
  v.object({
    title: v.string().min(1).max(500).optional(),
    body: v.string().optional(),
    state: getIssueStateSchema().optional(),
    labels: v.array(getLabelSchema()).optional(),
    milestone: v.string().nullable().optional(),
    assignees: v.array(v.string()).optional(),
  })
);
export const updateIssueSchema = getUpdateIssueSchema();

export const getListIssuesSchema = defineSchema((v) =>
  v.object({
    state: getIssueStateSchema().optional(),
    labels: v.array(getLabelSchema()).optional(),
    milestone: v.string().optional(),
    assignee: v.string().optional(),
    prefix: getIssuePrefixSchema().optional(),
    sortBy: v.enum(["created_at", "updated_at", "id"]).optional(),
    sortDirection: v.enum(["asc", "desc"]).optional(),
    limit: v.number().positive().optional(),
  })
);
export const listIssuesSchema = getListIssuesSchema();

export const getListIssuesResultSchema = defineSchema((v) =>
  v.object({
    issues: v.array(getIssueSchema()),
    total: v.number(),
  })
);
export const listIssuesResultSchema = getListIssuesResultSchema();

// Inferred types
export type IssueState = InferSchema<ReturnType<typeof getIssueStateSchema>>;
export type IssuePrefix = InferSchema<ReturnType<typeof getIssuePrefixSchema>>;
export type IssueMetadata = InferSchema<ReturnType<typeof getIssueMetadataSchema>>;
export type Issue = InferSchema<ReturnType<typeof getIssueSchema>>;
export type CreateIssueOptions = InferSchema<ReturnType<typeof getCreateIssueSchema>>;
export type UpdateIssueOptions = InferSchema<ReturnType<typeof getUpdateIssueSchema>>;
export type ListIssuesOptions = InferSchema<ReturnType<typeof getListIssuesSchema>>;
export type ListIssuesResult = InferSchema<ReturnType<typeof getListIssuesResultSchema>>;

// Validation functions
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

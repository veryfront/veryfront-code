import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";
import type { Schema } from "#veryfront/extensions/schema/index.ts";
import { ISSUES_DIR } from "../constants.ts";

/** Resource limits enforced by file-backed issue storage and schemas. */
export interface IssueStorageLimits {
  /** Maximum number of issue or reservation entries scanned per operation. */
  readonly maxIssues: number;
  /** Maximum UTF-8 bytes read from one issue file. */
  readonly maxFileBytes: number;
  /** Maximum UTF-8 bytes accepted in YAML frontmatter. */
  readonly maxFrontmatterBytes: number;
  /** Maximum characters accepted in an issue body. */
  readonly maxBodyCharacters: number;
  /** Maximum UTF-8 bytes accepted in an issue body. */
  readonly maxBodyBytes: number;
  /** Maximum labels stored on one issue or supplied as one filter. */
  readonly maxLabels: number;
  /** Maximum assignees stored on one issue. */
  readonly maxAssignees: number;
  /** Maximum issues returned by an explicitly limited list request. */
  readonly maxListLimit: number;
  /** Maximum serialized bytes retained for one list result. */
  readonly maxListResultBytes: number;
  /** Maximum decimal digits in an issue sequence number. */
  readonly maxIdDigits: number;
  /** Maximum characters accepted in a filesystem path. */
  readonly maxPathCharacters: number;
  /** Maximum entries inspected during one directory scan. */
  readonly maxDirectoryEntries: number;
  /** Maximum active and queued mutations retained for one issue. */
  readonly maxPendingMutationsPerIssue: number;
}

/** Stable resource policy for the file-backed issue format. */
export const ISSUE_STORAGE_LIMITS: Readonly<IssueStorageLimits> = Object.freeze({
  maxIssues: 10_000,
  maxFileBytes: 1_048_576,
  maxFrontmatterBytes: 65_536,
  maxBodyCharacters: 900_000,
  maxBodyBytes: 900_000,
  maxLabels: 100,
  maxAssignees: 100,
  maxListLimit: 1_000,
  maxListResultBytes: 16 * 1_048_576,
  maxIdDigits: 10,
  maxPathCharacters: 4_096,
  maxDirectoryEntries: 20_000,
  maxPendingMutationsPerIssue: 32,
});

/** Supported prefixes for file-backed issue identifiers. */
export const ISSUE_PREFIXES: readonly ["ISSUE", "TASK", "PLAN"] = Object.freeze([
  "ISSUE",
  "TASK",
  "PLAN",
]);

/** Canonical issue state. */
export type IssueState = "open" | "closed";
/** Supported issue identifier prefix. */
export type IssuePrefix = "ISSUE" | "TASK" | "PLAN";
/** Persisted issue metadata. */
export type IssueMetadata = {
  id: string;
  title: string;
  state: IssueState;
  labels: string[];
  milestone?: string;
  assignees: string[];
  created_at: string;
  updated_at: string;
};
/** Complete file-backed issue document. */
export type Issue = {
  metadata: IssueMetadata;
  body: string;
  path: string;
};
/** Options accepted when creating an issue. */
export type CreateIssueOptions = {
  title: string;
  body?: string;
  labels?: string[];
  milestone?: string;
  assignees?: string[];
  prefix?: IssuePrefix;
};
/** Options accepted when updating an issue. */
export type UpdateIssueOptions = {
  title?: string;
  body?: string;
  state?: IssueState;
  labels?: string[];
  milestone?: string | null;
  assignees?: string[];
};
/** Filters and ordering accepted when listing issues. */
export type ListIssuesOptions = {
  state?: IssueState;
  labels?: string[];
  milestone?: string;
  assignee?: string;
  prefix?: IssuePrefix;
  sortBy?: "created_at" | "updated_at" | "id";
  sortDirection?: "asc" | "desc";
  limit?: number;
};
/** Result returned when listing issues. */
export type ListIssuesResult = {
  issues: Issue[];
  total: number;
};

const ISSUE_ID_BODY = `(${ISSUE_PREFIXES.join("|")})-(\\d{3,${ISSUE_STORAGE_LIMITS.maxIdDigits}})`;
const ISSUE_ID_SOURCE = `^${ISSUE_ID_BODY}$`;
const ISSUE_ID_MATCH_PATTERN = new RegExp(ISSUE_ID_SOURCE);
const MAX_ISSUE_PREFIX_LENGTH = Math.max(...ISSUE_PREFIXES.map((prefix) => prefix.length));

/** Bounded syntactic pattern for issue identifiers. */
export const ISSUE_ID_PATTERN: RegExp = new RegExp(ISSUE_ID_SOURCE);

const MAX_TITLE_LENGTH = 500;
const MAX_LABEL_LENGTH = 50;
const MAX_TEXT_FIELD_LENGTH = 256;
const MAX_TIMESTAMP_LENGTH = 64;
const UTF8_ENCODER = new TextEncoder();

function hasNoUnsafeMetadataCharacters(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (
      codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f) ||
      codePoint === 0x061c || codePoint === 0x200e || codePoint === 0x200f ||
      codePoint === 0x2028 || codePoint === 0x2029 ||
      (codePoint >= 0x202a && codePoint <= 0x202e) ||
      (codePoint >= 0x2066 && codePoint <= 0x2069)
    ) return false;
  }
  return true;
}

function hasVisibleText(value: string): boolean {
  return value.trim().length > 0;
}

function hasUniqueValues(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function hasBoundedUtf8Length(value: string, maximumBytes: number): boolean {
  return value.length <= maximumBytes && UTF8_ENCODER.encode(value).byteLength <= maximumBytes;
}

/** Return the canonical open-or-closed issue-state schema. */
export const getIssueStateSchema: () => Schema<IssueState> = defineSchema((v) =>
  v.enum(["open", "closed"] as const)
);
/** Lazy canonical issue-state schema. */
export const issueStateSchema: Schema<IssueState> = lazySchema(getIssueStateSchema);

/** Return the supported issue-prefix schema. */
export const getIssuePrefixSchema: () => Schema<IssuePrefix> = defineSchema((v) =>
  v.enum(ISSUE_PREFIXES)
);
/** Lazy issue-prefix schema. */
export const issuePrefixSchema: Schema<IssuePrefix> = lazySchema(
  getIssuePrefixSchema,
);

/** Return the bounded issue-identifier schema. */
export const getIssueIdSchema: () => Schema<string> = defineSchema((v) =>
  v.string()
    .max(MAX_ISSUE_PREFIX_LENGTH + 1 + ISSUE_STORAGE_LIMITS.maxIdDigits)
    .regex(new RegExp(ISSUE_ID_SOURCE), "Issue ID must use a supported prefix and numeric suffix")
    .refine(isValidIssueId, "Issue ID sequence number must be greater than zero")
    .describe("Issue ID, for example ISSUE-001 or TASK-042")
);
/** Lazy issue-identifier schema. */
export const issueIdSchema: Schema<string> = lazySchema(getIssueIdSchema);

/** Return the bounded single-line label schema. */
export const getLabelSchema: () => Schema<string> = defineSchema((v) =>
  v.string().min(1).max(MAX_LABEL_LENGTH)
    .refine(hasVisibleText, "Label cannot be blank")
    .refine(
      hasNoUnsafeMetadataCharacters,
      "Label cannot contain control or bidirectional formatting characters",
    )
);
/** Lazy issue-label schema. */
export const labelSchema: Schema<string> = lazySchema(getLabelSchema);

/** Return the bounded ISO date-time schema used by issue metadata. */
export const getIsoDateSchema: () => Schema<string> = defineSchema((v) =>
  v.string().max(MAX_TIMESTAMP_LENGTH).datetime()
);
/** Lazy ISO date-time schema. */
export const isoDateSchema: Schema<string> = lazySchema(getIsoDateSchema);

/** Return the character- and byte-bounded issue-body schema. */
export const getIssueBodySchema: () => Schema<string> = defineSchema((v) =>
  v.string().max(ISSUE_STORAGE_LIMITS.maxBodyCharacters)
    .refine((body) => !body.includes("\0"), "Issue body cannot contain NUL bytes")
    .refine(
      (body) => hasBoundedUtf8Length(body, ISSUE_STORAGE_LIMITS.maxBodyBytes),
      "Issue body exceeds the supported UTF-8 byte limit",
    )
);
/** Lazy issue-body schema. */
export const issueBodySchema: Schema<string> = lazySchema(getIssueBodySchema);

const getIssueTitleSchema: () => Schema<string> = defineSchema((v) =>
  v.string().min(1).max(MAX_TITLE_LENGTH)
    .refine(hasVisibleText, "Issue title cannot be blank")
    .refine(
      hasNoUnsafeMetadataCharacters,
      "Issue title cannot contain control or bidirectional formatting characters",
    )
);

const getMilestoneSchema: () => Schema<string> = defineSchema((v) =>
  v.string().min(1).max(MAX_TEXT_FIELD_LENGTH)
    .refine(hasVisibleText, "Milestone cannot be blank")
    .refine(
      hasNoUnsafeMetadataCharacters,
      "Milestone cannot contain control or bidirectional formatting characters",
    )
);

const getAssigneeSchema: () => Schema<string> = defineSchema((v) =>
  v.string().min(1).max(MAX_TEXT_FIELD_LENGTH)
    .refine(hasVisibleText, "Assignee cannot be blank")
    .refine(
      hasNoUnsafeMetadataCharacters,
      "Assignee cannot contain control or bidirectional formatting characters",
    )
);

/** Return the complete persisted issue-metadata schema. */
export const getIssueMetadataSchema: () => Schema<IssueMetadata> = defineSchema((v) =>
  v.object({
    id: getIssueIdSchema(),
    title: getIssueTitleSchema(),
    state: getIssueStateSchema(),
    labels: v.array(getLabelSchema()).max(ISSUE_STORAGE_LIMITS.maxLabels)
      .refine(hasUniqueValues, "Issue labels must be unique").default([]),
    milestone: getMilestoneSchema().optional(),
    assignees: v.array(getAssigneeSchema()).max(ISSUE_STORAGE_LIMITS.maxAssignees)
      .refine(hasUniqueValues, "Issue assignees must be unique").default([]),
    created_at: getIsoDateSchema(),
    updated_at: getIsoDateSchema(),
  }).strict().superRefine((metadata, context) => {
    if (Date.parse(metadata.updated_at) < Date.parse(metadata.created_at)) {
      context.addIssue({
        code: "custom",
        message: "Issue update time cannot precede its creation time",
        path: ["updated_at"],
      });
    }
  })
);
/** Lazy persisted issue-metadata schema. */
export const issueMetadataSchema: Schema<IssueMetadata> = lazySchema(
  getIssueMetadataSchema,
);

/** Return the complete issue-document schema. */
export const getIssueSchema: () => Schema<Issue> = defineSchema((v) =>
  v.object({
    metadata: getIssueMetadataSchema(),
    body: getIssueBodySchema(),
    path: v.string().min(1).max(ISSUE_STORAGE_LIMITS.maxPathCharacters).refine(
      (path) => !path.includes("\0"),
      "Issue path cannot contain NUL bytes",
    ),
  }).strict().superRefine((issue, context) => {
    const expectedPath = `${ISSUES_DIR}/${issue.metadata.id}.md`;
    if (issue.path !== expectedPath) {
      context.addIssue({
        code: "custom",
        message: "Issue path must match its metadata ID",
        path: ["path"],
      });
    }
  })
);
/** Lazy complete issue-document schema. */
export const issueSchema: Schema<Issue> = lazySchema(getIssueSchema);

/** Return the public create-issue input schema. */
export const getCreateIssueSchema: () => Schema<CreateIssueOptions> = defineSchema((v) =>
  v.object({
    title: getIssueTitleSchema().describe("Issue title"),
    body: getIssueBodySchema().optional().describe(
      "Issue description in markdown",
    ),
    labels: v.array(getLabelSchema()).max(ISSUE_STORAGE_LIMITS.maxLabels)
      .refine(hasUniqueValues, "Issue labels must be unique").optional().describe(
        "Labels to apply",
      ),
    milestone: getMilestoneSchema().optional().describe("Milestone to assign"),
    assignees: v.array(getAssigneeSchema()).max(ISSUE_STORAGE_LIMITS.maxAssignees)
      .refine(hasUniqueValues, "Issue assignees must be unique").optional().describe(
        "Users to assign",
      ),
    prefix: getIssuePrefixSchema().optional().describe("ID prefix: ISSUE, TASK, or PLAN"),
  }).strict()
);
/** Lazy create-issue input schema. */
export const createIssueSchema: Schema<CreateIssueOptions> = lazySchema(
  getCreateIssueSchema,
);

/** Return the public update-issue input schema. */
export const getUpdateIssueSchema: () => Schema<UpdateIssueOptions> = defineSchema((v) =>
  v.object({
    title: getIssueTitleSchema().optional().describe("New title"),
    body: getIssueBodySchema().optional().describe(
      "New body content",
    ),
    state: getIssueStateSchema().optional().describe("New canonical issue state"),
    labels: v.array(getLabelSchema()).max(ISSUE_STORAGE_LIMITS.maxLabels)
      .refine(hasUniqueValues, "Issue labels must be unique").optional().describe(
        "Labels to set, replacing existing labels",
      ),
    milestone: getMilestoneSchema().nullable().optional().describe(
      "Milestone, or null to remove it",
    ),
    assignees: v.array(getAssigneeSchema()).max(ISSUE_STORAGE_LIMITS.maxAssignees)
      .refine(hasUniqueValues, "Issue assignees must be unique").optional().describe(
        "Assignees to set, replacing existing assignees",
      ),
  }).strict()
);
/** Lazy update-issue input schema. */
export const updateIssueSchema: Schema<UpdateIssueOptions> = lazySchema(
  getUpdateIssueSchema,
);

/** Return the public list-issues query schema. */
export const getListIssuesSchema: () => Schema<ListIssuesOptions> = defineSchema((v) =>
  v.object({
    state: getIssueStateSchema().optional().describe("Filter by state"),
    labels: v.array(getLabelSchema()).max(ISSUE_STORAGE_LIMITS.maxLabels)
      .refine(hasUniqueValues, "Issue label filters must be unique").optional().describe(
        "Filter by all listed labels",
      ),
    milestone: getMilestoneSchema().optional().describe("Filter by milestone"),
    assignee: getAssigneeSchema().optional().describe("Filter by assignee"),
    prefix: getIssuePrefixSchema().optional().describe("Filter by issue prefix"),
    sortBy: v.enum(["created_at", "updated_at", "id"] as const).optional().describe(
      "Sort field",
    ),
    sortDirection: v.enum(["asc", "desc"] as const).optional().describe("Sort direction"),
    limit: v.number().int().positive().max(ISSUE_STORAGE_LIMITS.maxListLimit).optional().describe(
      "Maximum returned issues",
    ),
  }).strict()
);
/** Lazy list-issues query schema. */
export const listIssuesSchema: Schema<ListIssuesOptions> = lazySchema(
  getListIssuesSchema,
);

/** Return the list-issues result schema. */
export const getListIssuesResultSchema: () => Schema<ListIssuesResult> = defineSchema((v) =>
  v.object({
    issues: v.array(getIssueSchema()).max(ISSUE_STORAGE_LIMITS.maxIssues),
    total: v.number().int().nonnegative().max(ISSUE_STORAGE_LIMITS.maxIssues),
  }).strict()
);
/** Lazy list-issues result schema. */
export const listIssuesResultSchema: Schema<ListIssuesResult> = lazySchema(
  getListIssuesResultSchema,
);

/** Validate and normalize persisted issue metadata. */
export function validateMetadata(data: unknown): IssueMetadata {
  return issueMetadataSchema.parse(data);
}

function parseIssueIdParts(id: unknown): { prefix: IssuePrefix; number: number } | null {
  if (typeof id !== "string") return null;
  const match = ISSUE_ID_MATCH_PATTERN.exec(id);
  if (!match || !match[1] || !match[2]) return null;
  const number = Number(match[2]);
  if (!Number.isSafeInteger(number) || number <= 0) return null;
  return { prefix: match[1] as IssuePrefix, number };
}

/** Return whether a value is a bounded issue identifier with a positive sequence number. */
export function isValidIssueId(id: string): boolean {
  return parseIssueIdParts(id) !== null;
}

/** Parse a valid issue identifier into its prefix and numeric component. */
export function parseIssueId(id: string): { prefix: IssuePrefix; number: number } | null {
  return parseIssueIdParts(id);
}

/** Generate the next bounded identifier for a prefix. */
export function generateIssueId(prefix: IssuePrefix, existingIds: string[]): string {
  if (!ISSUE_PREFIXES.includes(prefix)) {
    throw new TypeError("Issue prefix is invalid");
  }
  if (!Array.isArray(existingIds)) {
    throw new TypeError("Existing issue IDs must be an array");
  }
  if (existingIds.length >= ISSUE_STORAGE_LIMITS.maxIssues) {
    throw new RangeError("Existing issue ID count exceeds the supported limit");
  }

  let maximum = 0;
  for (const id of existingIds) {
    const parsed = parseIssueIdParts(id);
    if (parsed?.prefix === prefix && parsed.number > maximum) maximum = parsed.number;
  }
  const nextNumber = maximum + 1;
  if (
    !Number.isSafeInteger(nextNumber) ||
    nextNumber.toString().length > ISSUE_STORAGE_LIMITS.maxIdDigits
  ) {
    throw new RangeError("Issue ID sequence is exhausted");
  }
  return `${prefix}-${nextNumber.toString().padStart(3, "0")}`;
}

const STATE_ALIASES: Readonly<Record<string, IssueState>> = Object.freeze({
  open: "open",
  opened: "open",
  active: "open",
  closed: "closed",
  close: "closed",
  done: "closed",
  resolved: "closed",
  completed: "closed",
});

/** Normalize a canonical issue state or supported human-facing alias. */
export function parseState(value: string): IssueState | null {
  if (typeof value !== "string") return null;
  const normalized = value.toLowerCase().trim();
  return STATE_ALIASES[normalized] ?? null;
}

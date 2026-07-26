import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";

export const ISSUE_PREFIXES = ["ISSUE", "TASK", "PLAN"] as const;
/** Canonical states and accepted user-facing state aliases. */
export const ISSUE_STATE_INPUTS = [
  "open",
  "opened",
  "active",
  "closed",
  "close",
  "done",
  "resolved",
  "completed",
] as const;
/** Maximum issue title length in UTF-16 code units. */
export const MAX_ISSUE_TITLE_LENGTH = 500;
/** Maximum issue body length in UTF-16 code units. */
export const MAX_ISSUE_BODY_LENGTH = 1_000_000;
/** Maximum length of one label. */
export const MAX_ISSUE_LABEL_LENGTH = 50;
/** Maximum labels stored on one issue or accepted by one filter. */
export const MAX_ISSUE_LABELS = 64;
/** Maximum milestone length. */
export const MAX_ISSUE_MILESTONE_LENGTH = 200;
/** Maximum length of one assignee identifier. */
export const MAX_ISSUE_ASSIGNEE_LENGTH = 100;
/** Maximum assignees stored on one issue. */
export const MAX_ISSUE_ASSIGNEES = 64;
/** Maximum explicitly requested list result count. */
export const MAX_ISSUE_LIST_LIMIT = 1_000;
/** Maximum project or issue path length accepted at module boundaries. */
export const MAX_ISSUE_PATH_LENGTH = 4_096;

const MAX_ISSUE_ID_DIGITS = Number.MAX_SAFE_INTEGER.toString().length;
const ISSUE_ID_BODY = `(${ISSUE_PREFIXES.join("|")})-(\\d{3,${MAX_ISSUE_ID_DIGITS}})`;
const ISO_DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):(\d{2}))$/u;

export const ISSUE_ID_PATTERN = new RegExp(`^${ISSUE_ID_BODY}$`);

export const getIssueStateSchema = defineSchema((v) => v.enum(["open", "closed"]));
export const issueStateSchema = lazySchema(getIssueStateSchema);

export const getIssuePrefixSchema = defineSchema((v) => v.enum(ISSUE_PREFIXES));
export const issuePrefixSchema = lazySchema(getIssuePrefixSchema);

export const getIssueIdSchema = defineSchema((v) =>
  v.string()
    .max(ISSUE_PREFIXES[0].length + 1 + MAX_ISSUE_ID_DIGITS)
    .regex(ISSUE_ID_PATTERN, "Issue ID must be in format PREFIX-NNN (e.g., ISSUE-001, TASK-042)")
    .refine(isValidIssueId, "Issue ID must contain a positive safe integer")
);
export const issueIdSchema = lazySchema(getIssueIdSchema);

function isWellFormedText(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index++;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function isNormalizedMetadataText(value: string): boolean {
  if (value.trim() !== value || value.length === 0 || !isWellFormedText(value)) return false;

  for (let index = 0; index < value.length; index++) {
    const codeUnit = value.charCodeAt(index);
    if (
      codeUnit <= 0x1f ||
      (codeUnit >= 0x7f && codeUnit <= 0x9f) ||
      codeUnit === 0x2028 ||
      codeUnit === 0x2029
    ) {
      return false;
    }
  }
  return true;
}

function isSafeIssueBody(value: string): boolean {
  if (!isWellFormedText(value)) return false;

  for (let index = 0; index < value.length; index++) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit === 0x09 || codeUnit === 0x0a) continue;
    if (codeUnit === 0x0d) {
      if (value.charCodeAt(index + 1) !== 0x0a) return false;
      continue;
    }
    if (
      codeUnit <= 0x1f ||
      (codeUnit >= 0x7f && codeUnit <= 0x9f) ||
      codeUnit === 0x2028 ||
      codeUnit === 0x2029
    ) {
      return false;
    }
  }
  return true;
}

function isSafeIssuePath(value: string): boolean {
  if (!isWellFormedText(value)) return false;

  for (let index = 0; index < value.length; index++) {
    const codeUnit = value.charCodeAt(index);
    if (
      codeUnit <= 0x1f ||
      (codeUnit >= 0x7f && codeUnit <= 0x9f) ||
      codeUnit === 0x2028 ||
      codeUnit === 0x2029
    ) {
      return false;
    }
  }
  return true;
}

function hasUniqueValues(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function parseIsoDateTimeNanoseconds(value: string): bigint | null {
  const match = ISO_DATE_TIME_PATTERN.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[10] === undefined ? 0 : Number(match[10]);
  const offsetMinute = match[11] === undefined ? 0 : Number(match[11]);

  if (
    month < 1 || month > 12 ||
    day < 1 || day > 31 ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 14 ||
    offsetMinute > 59 ||
    (offsetHour === 14 && offsetMinute !== 0)
  ) {
    return null;
  }

  const calendar = new Date(0);
  calendar.setUTCHours(0, 0, 0, 0);
  calendar.setUTCFullYear(year, month - 1, day);
  calendar.setUTCHours(hour, minute, second, 0);
  if (
    calendar.getUTCFullYear() !== year ||
    calendar.getUTCMonth() !== month - 1 ||
    calendar.getUTCDate() !== day ||
    calendar.getUTCHours() !== hour ||
    calendar.getUTCMinutes() !== minute ||
    calendar.getUTCSeconds() !== second
  ) {
    return null;
  }

  const offsetDirection = match[9] === "-" ? -1 : 1;
  const offsetSeconds = offsetDirection * (offsetHour * 60 + offsetMinute) * 60;
  const utcSeconds = calendar.getTime() / 1_000 - offsetSeconds;
  const fractionalNanoseconds = BigInt((match[7] ?? "").padEnd(9, "0"));
  return BigInt(utcSeconds) * 1_000_000_000n + fractionalNanoseconds;
}

function isIsoDateTime(value: string): boolean {
  return parseIsoDateTimeNanoseconds(value) !== null;
}

/** Compare two validated issue timestamps with nanosecond and offset precision. */
export function compareIssueDateTimes(left: string, right: string): number {
  const leftNanoseconds = parseIsoDateTimeNanoseconds(left);
  const rightNanoseconds = parseIsoDateTimeNanoseconds(right);
  if (leftNanoseconds === null || rightNanoseconds === null) {
    throw new RangeError("Issue date comparison requires valid ISO 8601 date-times");
  }
  if (leftNanoseconds < rightNanoseconds) return -1;
  if (leftNanoseconds > rightNanoseconds) return 1;
  return 0;
}

export const getIssueTitleSchema = defineSchema((v) =>
  v.string()
    .min(1)
    .max(MAX_ISSUE_TITLE_LENGTH)
    .refine(
      isNormalizedMetadataText,
      "Title must be trimmed, non-empty, and free of control characters",
    )
);

export const getIssueBodySchema = defineSchema((v) =>
  v.string()
    .max(MAX_ISSUE_BODY_LENGTH)
    .refine(
      isSafeIssueBody,
      "Issue body must be well-formed text without terminal control characters",
    )
);

export const getLabelSchema = defineSchema((v) =>
  v.string()
    .min(1)
    .max(MAX_ISSUE_LABEL_LENGTH)
    .refine(
      isNormalizedMetadataText,
      "Label must be trimmed, non-empty, and free of control characters",
    )
);
export const labelSchema = lazySchema(getLabelSchema);

export const getIssueLabelsSchema = defineSchema((v) =>
  v.array(getLabelSchema())
    .max(MAX_ISSUE_LABELS)
    .refine(hasUniqueValues, "Labels must be unique")
);

export const getIssueMilestoneSchema = defineSchema((v) =>
  v.string()
    .min(1)
    .max(MAX_ISSUE_MILESTONE_LENGTH)
    .refine(
      isNormalizedMetadataText,
      "Milestone must be trimmed, non-empty, and free of control characters",
    )
);

export const getIssueAssigneeSchema = defineSchema((v) =>
  v.string()
    .min(1)
    .max(MAX_ISSUE_ASSIGNEE_LENGTH)
    .refine(
      isNormalizedMetadataText,
      "Assignee must be trimmed, non-empty, and free of control characters",
    )
);

export const getIssueAssigneesSchema = defineSchema((v) =>
  v.array(getIssueAssigneeSchema())
    .max(MAX_ISSUE_ASSIGNEES)
    .refine(hasUniqueValues, "Assignees must be unique")
);

export const getIssuePathSchema = defineSchema((v) =>
  v.string()
    .min(1)
    .max(MAX_ISSUE_PATH_LENGTH)
    .refine(
      isSafeIssuePath,
      "Issue path must be well-formed text without control characters",
    )
);

export const getIsoDateSchema = defineSchema((v) =>
  v.string()
    .refine(isIsoDateTime, "Must be a valid ISO 8601 date-time with an explicit offset")
);
export const isoDateSchema = lazySchema(getIsoDateSchema);

export const getIssueMetadataSchema = defineSchema((v) =>
  v.object({
    id: getIssueIdSchema(),
    title: getIssueTitleSchema(),
    state: getIssueStateSchema(),
    labels: getIssueLabelsSchema().default([]),
    milestone: getIssueMilestoneSchema().optional(),
    assignees: getIssueAssigneesSchema().default([]),
    created_at: getIsoDateSchema(),
    updated_at: getIsoDateSchema(),
  }).strict().refine(
    (metadata) => {
      const createdAt = parseIsoDateTimeNanoseconds(metadata.created_at);
      const updatedAt = parseIsoDateTimeNanoseconds(metadata.updated_at);
      return createdAt !== null && updatedAt !== null && updatedAt >= createdAt;
    },
    "updated_at must not be earlier than created_at",
  )
);
export const issueMetadataSchema = lazySchema(getIssueMetadataSchema);

export const getIssueSchema = defineSchema((v) =>
  v.object({
    metadata: getIssueMetadataSchema(),
    body: getIssueBodySchema(),
    path: getIssuePathSchema(),
  }).strict()
);
export const issueSchema = lazySchema(getIssueSchema);

export const getCreateIssueSchema = defineSchema((v) =>
  v.object({
    title: getIssueTitleSchema(),
    body: getIssueBodySchema().optional(),
    labels: getIssueLabelsSchema().optional(),
    milestone: getIssueMilestoneSchema().optional(),
    assignees: getIssueAssigneesSchema().optional(),
    prefix: getIssuePrefixSchema().optional(),
  }).strict()
);
export const createIssueSchema = lazySchema(getCreateIssueSchema);

export const getUpdateIssueSchema = defineSchema((v) =>
  v.object({
    title: getIssueTitleSchema().optional(),
    body: getIssueBodySchema().optional(),
    state: getIssueStateSchema().optional(),
    labels: getIssueLabelsSchema().optional(),
    milestone: getIssueMilestoneSchema().nullable().optional(),
    assignees: getIssueAssigneesSchema().optional(),
  }).strict()
);
export const updateIssueSchema = lazySchema(getUpdateIssueSchema);

export const getListIssuesSchema = defineSchema((v) =>
  v.object({
    state: getIssueStateSchema().optional(),
    labels: getIssueLabelsSchema().optional(),
    milestone: getIssueMilestoneSchema().optional(),
    assignee: getIssueAssigneeSchema().optional(),
    prefix: getIssuePrefixSchema().optional(),
    sortBy: v.enum(["created_at", "updated_at", "id"]).optional(),
    sortDirection: v.enum(["asc", "desc"]).optional(),
    limit: v.number().int().positive().max(MAX_ISSUE_LIST_LIMIT).optional(),
  }).strict()
);
export const listIssuesSchema = lazySchema(getListIssuesSchema);

export const getListIssuesResultSchema = defineSchema((v) =>
  v.object({
    issues: v.array(getIssueSchema()),
    total: v.number().int().nonnegative(),
  }).strict().refine(
    (result) => result.total >= result.issues.length,
    "Issue result total must cover every returned issue",
  )
);
export const listIssuesResultSchema = lazySchema(getListIssuesResultSchema);

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
  return parseIssueId(id) !== null;
}

export function parseIssueId(id: string): { prefix: IssuePrefix; number: number } | null {
  const match = ISSUE_ID_PATTERN.exec(id);
  if (!match || !match[1] || !match[2]) return null;

  const number = Number(match[2]);
  if (!Number.isSafeInteger(number) || number <= 0) return null;

  return {
    prefix: match[1] as IssuePrefix,
    number,
  };
}

export function generateIssueId(prefix: IssuePrefix, existingIds: string[]): string {
  let maximum = 0;
  for (const id of existingIds) {
    const parsed = parseIssueId(id);
    if (parsed?.prefix === prefix && parsed.number > maximum) maximum = parsed.number;
  }
  if (maximum >= Number.MAX_SAFE_INTEGER) {
    throw new RangeError(`Issue ID space exhausted for ${prefix}`);
  }
  const nextNumber = maximum + 1;
  return `${prefix}-${nextNumber.toString().padStart(3, "0")}`;
}

const STATE_ALIASES: Record<(typeof ISSUE_STATE_INPUTS)[number], IssueState> = {
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
  if (!Object.prototype.hasOwnProperty.call(STATE_ALIASES, normalized)) return null;
  return STATE_ALIASES[normalized as keyof typeof STATE_ALIASES];
}

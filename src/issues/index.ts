/**
 * File-backed project issue tracking.
 *
 * Issues are schema-validated Markdown files under `issues/`. Successful IDs
 * have persistent reservation markers under `issues/.ids` and are never
 * reused. Mutations use atomic replacement on the default filesystem adapters
 * and per-ID directories under `issues/.locks` to reject concurrent writers.
 * Corrupt files, unsafe paths, storage failures, and lock conflicts surface as
 * errors rather than appearing as missing data.
 *
 * @module issues
 */

export type {
  CreateIssueOptions,
  Issue,
  IssueMetadata,
  IssuePrefix,
  IssueState,
  ListIssuesOptions,
  ListIssuesResult,
  UpdateIssueOptions,
} from "./schemas/index.ts";

export {
  compareIssueDateTimes,
  createIssueSchema,
  generateIssueId,
  ISSUE_ID_PATTERN,
  ISSUE_PREFIXES,
  ISSUE_STATE_INPUTS,
  issueIdSchema,
  issueMetadataSchema,
  issueStateSchema,
  isValidIssueId,
  listIssuesSchema,
  MAX_ISSUE_ASSIGNEE_LENGTH,
  MAX_ISSUE_ASSIGNEES,
  MAX_ISSUE_BODY_LENGTH,
  MAX_ISSUE_LABEL_LENGTH,
  MAX_ISSUE_LABELS,
  MAX_ISSUE_LIST_LIMIT,
  MAX_ISSUE_MILESTONE_LENGTH,
  MAX_ISSUE_PATH_LENGTH,
  MAX_ISSUE_TITLE_LENGTH,
  parseIssueId,
  parseState,
  updateIssueSchema,
  validateMetadata,
} from "./schemas/index.ts";

export { ISSUE_FILE_INVALID, ISSUE_STORAGE_CONFLICT } from "./errors.ts";

export {
  createIssuesManager,
  ISSUES_DIR,
  IssuesManager,
  MAX_ISSUE_FILE_BYTES,
  MAX_ISSUE_FRONTMATTER_LENGTH,
  parseFrontmatter,
  parseIssue,
  parseYaml,
  serializeIssue,
  serializeYaml,
} from "./core.ts";

export { issuesMcpTools } from "./mcp.ts";

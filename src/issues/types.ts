/**
 * File-based issue tracking types
 *
 * Simplified 8-field schema for SDLC conventions:
 * - Issues, tasks, and plans are stored as markdown files with YAML frontmatter
 * - Location: `issues/` directory at project root
 * - File naming: ISSUE-001.md, TASK-001.md, PLAN-001.md
 *
 * @module issues/types
 */

/**
 * Issue state - simple open/closed model
 */
export type IssueState = "open" | "closed";

/**
 * Issue metadata stored in YAML frontmatter
 *
 * Follows conventions from GitHub Issues, Linear, and ADR standards.
 * Labels use colon syntax for categorization (e.g., "priority:high", "type:bug")
 */
export interface IssueMetadata {
  /** Unique identifier: ISSUE-xxx, TASK-xxx, PLAN-xxx */
  id: string;

  /** Brief title describing the issue */
  title: string;

  /** Current state: open or closed */
  state: IssueState;

  /** Labels for categorization (e.g., ["bug", "priority:high", "type:task"]) */
  labels: string[];

  /** Optional milestone this issue belongs to */
  milestone?: string;

  /** Assigned users (usernames or emails) */
  assignees: string[];

  /** ISO 8601 timestamp when created */
  created_at: string;

  /** ISO 8601 timestamp when last updated */
  updated_at: string;
}

/**
 * Complete issue with metadata and markdown body
 */
export interface Issue {
  /** Frontmatter metadata */
  metadata: IssueMetadata;

  /** Markdown body content */
  body: string;

  /** File path relative to project root (e.g., "issues/ISSUE-001.md") */
  path: string;
}

/**
 * Options for creating a new issue
 */
export interface CreateIssueOptions {
  /** Issue title (required) */
  title: string;

  /** Issue body in markdown (optional) */
  body?: string;

  /** Labels to apply (optional) */
  labels?: string[];

  /** Milestone to assign (optional) */
  milestone?: string;

  /** Users to assign (optional) */
  assignees?: string[];

  /** ID prefix: ISSUE, TASK, or PLAN (defaults to ISSUE) */
  prefix?: "ISSUE" | "TASK" | "PLAN";
}

/**
 * Options for updating an existing issue
 */
export interface UpdateIssueOptions {
  /** New title (optional) */
  title?: string;

  /** New body content (optional) */
  body?: string;

  /** New state (optional) */
  state?: IssueState;

  /** Labels to set (replaces existing) */
  labels?: string[];

  /** Milestone to assign (optional) */
  milestone?: string | null;

  /** Assignees to set (replaces existing) */
  assignees?: string[];
}

/**
 * Options for listing issues
 */
export interface ListIssuesOptions {
  /** Filter by state */
  state?: IssueState;

  /** Filter by labels (issues must have ALL specified labels) */
  labels?: string[];

  /** Filter by milestone */
  milestone?: string;

  /** Filter by assignee */
  assignee?: string;

  /** Filter by ID prefix (ISSUE, TASK, PLAN) */
  prefix?: "ISSUE" | "TASK" | "PLAN";

  /** Sort by field */
  sortBy?: "created_at" | "updated_at" | "id";

  /** Sort direction */
  sortDirection?: "asc" | "desc";

  /** Maximum number of results */
  limit?: number;
}

/**
 * Result of a list operation
 */
export interface ListIssuesResult {
  /** Matching issues */
  issues: Issue[];

  /** Total count (before limit) */
  total: number;
}

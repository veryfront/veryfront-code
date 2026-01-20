/**
 * File-based issue tracking - GitHub compatible
 *
 * All issues are stored as markdown files with YAML frontmatter in `issues/`
 * following GitHub's native structure for easy sync.
 */

/**
 * GitHub native states
 */
export type IssueState = "open" | "closed"

/**
 * Issue types (stored as labels in GitHub)
 */
export type IssueType = "issue" | "plan" | "milestone"

/**
 * Base metadata - GitHub compatible
 */
export interface IssueMetadata {
  // GitHub native fields
  number?: number // GitHub issue number (for sync)
  title: string
  state: IssueState
  labels: string[] // GitHub labels: bug, enhancement, priority:high, type:plan
  milestone?: string // Milestone title
  assignees: string[] // GitHub usernames
  created_at: string // ISO 8601 (GitHub format)
  updated_at: string // ISO 8601 (GitHub format)

  // Local only
  id: string // Local ID (ISSUE-xxx, PLAN-xxx, MILESTONE-xxx)
}

/**
 * File representation of an issue
 */
export interface IssueFile {
  metadata: IssueMetadata
  content: string // markdown body
  path: string // file path
}

/**
 * Options for creating a new issue
 */
export interface CreateIssueOptions {
  title: string
  type?: IssueType
  labels?: string[]
  milestone?: string
  assignees?: string[]
  content: string
}

/**
 * Options for updating an issue
 */
export interface UpdateIssueOptions {
  id: string
  number?: number // GitHub issue number (for sync)
  title?: string
  state?: IssueState
  labels?: string[]
  milestone?: string
  assignees?: string[]
  content?: string
}

/**
 * Options for listing issues
 */
export interface ListIssuesOptions {
  type?: IssueType
  state?: IssueState
  milestone?: string
  assignee?: string
  labels?: string[]
  sortBy?: "created_at" | "updated_at" | "title"
  sortOrder?: "asc" | "desc"
}

/**
 * Statistics for issues
 */
export interface IssueStats {
  total: number
  byState: Record<IssueState, number>
  byType: Record<IssueType, number>
}

/**
 * File-based SDLC resource types
 *
 * All SDLC resources are stored as markdown files with YAML frontmatter
 * in `.veryfront/sdlc/` following convention-over-configuration.
 */

/**
 * Common statuses for SDLC resources
 */
export type SdlcStatus =
  | "todo"
  | "in_progress"
  | "blocked"
  | "in_review"
  | "done"
  | "cancelled"

/**
 * Priority levels
 */
export type SdlcPriority = "low" | "medium" | "high" | "critical"

/**
 * Resource types
 */
export type SdlcResourceType = "task" | "issue" | "plan" | "milestone" | "rfc"

/**
 * Base metadata common to all SDLC resources
 */
export interface SdlcResourceMetadata {
  id: string
  title: string
  status: SdlcStatus
  created: string // ISO 8601
  updated: string // ISO 8601
  labels?: string[]
}

/**
 * Task - Individual work item
 */
export interface SdlcTask extends SdlcResourceMetadata {
  type: "task"
  milestone?: string
  assignee?: string
  priority: SdlcPriority
  estimate?: number // hours
  parent?: string // parent task ID
  blockedBy?: string[]
  blocks?: string[]
}

/**
 * Issue - Bug report or feature request
 */
export interface SdlcIssue extends SdlcResourceMetadata {
  type: "issue"
  milestone?: string
  assignee?: string
  priority: SdlcPriority
  kind: "bug" | "feature" | "enhancement" | "documentation"
  reproducible?: boolean
  affectedVersion?: string
  targetVersion?: string
}

/**
 * Plan - Implementation design
 */
export interface SdlcPlan extends SdlcResourceMetadata {
  type: "plan"
  milestone?: string
  author?: string
  reviewers?: string[]
  approved?: boolean
  approvedBy?: string[]
  approvedAt?: string // ISO 8601
}

/**
 * Milestone - Release goal
 */
export interface SdlcMilestone extends SdlcResourceMetadata {
  type: "milestone"
  dueDate?: string // ISO 8601
  version?: string
  progress: number // 0-100
  tasks?: string[] // task IDs
  issues?: string[] // issue IDs
  plans?: string[] // plan IDs
}

/**
 * RFC - Design proposal
 */
export interface SdlcRfc extends SdlcResourceMetadata {
  type: "rfc"
  author?: string
  reviewers?: string[]
  approved?: boolean
  approvedBy?: string[]
  approvedAt?: string // ISO 8601
  supersedes?: string // RFC ID
  supersededBy?: string // RFC ID
}

/**
 * Union type for all SDLC resources
 */
export type SdlcResource =
  | SdlcTask
  | SdlcIssue
  | SdlcPlan
  | SdlcMilestone
  | SdlcRfc

/**
 * File representation of an SDLC resource
 */
export interface SdlcResourceFile<T extends SdlcResource = SdlcResource> {
  metadata: T
  content: string // markdown body
  path: string // file path
}

/**
 * Options for creating a new SDLC resource
 */
export interface CreateSdlcResourceOptions<T extends SdlcResource> {
  type: SdlcResourceType
  metadata: Omit<T, "created" | "updated" | "type">
  content: string
}

/**
 * Options for updating an SDLC resource
 */
export interface UpdateSdlcResourceOptions {
  id: string
  metadata?: Partial<SdlcResourceMetadata>
  content?: string
}

/**
 * Options for listing SDLC resources
 */
export interface ListSdlcResourcesOptions {
  type?: SdlcResourceType
  status?: SdlcStatus | SdlcStatus[]
  milestone?: string
  assignee?: string
  labels?: string[]
  sortBy?: "created" | "updated" | "priority" | "title"
  sortOrder?: "asc" | "desc"
}

/**
 * Statistics for SDLC resources
 */
export interface SdlcStats {
  total: number
  byStatus: Record<SdlcStatus, number>
  byType: Record<SdlcResourceType, number>
  byPriority: Record<SdlcPriority, number>
}

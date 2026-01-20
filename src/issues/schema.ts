/**
 * Zod schemas for issue validation - GitHub compatible
 * Handles migration from legacy format to GitHub-native format
 */

import { z } from "zod"

/**
 * ISO 8601 date-time string (flexible - accepts any valid date string)
 */
const isoDateString = z.string()

/**
 * Legacy status to state mapping
 */
const legacyStatusToState = {
  todo: "open",
  in_progress: "open",
  blocked: "open",
  in_review: "open",
  done: "closed",
  cancelled: "closed",
} as const

/**
 * GitHub native states with legacy fallback
 */
export const issueStateSchema = z.union([
  z.enum(["open", "closed"]),
  // Accept legacy status and map to state
  z.enum(["todo", "in_progress", "blocked", "in_review", "done", "cancelled"])
    .transform((status) => legacyStatusToState[status]),
])

/**
 * Issue types (stored as labels in GitHub)
 */
export const issueTypeSchema = z.enum(["issue", "plan", "milestone", "task", "rfc"])

/**
 * Issue metadata schema - GitHub compatible with legacy support
 */
export const issueMetadataSchema = z.object({
  // GitHub native fields
  number: z.number().optional(),
  title: z.string().min(1).max(200),

  // State - accept both new and legacy formats
  state: issueStateSchema.optional().default("open"),
  status: z.string().optional(), // Legacy field (ignored but accepted)

  labels: z.array(z.string()).default([]),
  milestone: z.string().optional(),

  // Assignees - accept both array and single string
  assignees: z.union([
    z.array(z.string()),
    z.string().transform((s) => s ? [s] : []),
  ]).default([]),
  assignee: z.string().optional(), // Legacy field

  // Dates - accept both formats
  created_at: isoDateString.optional(),
  updated_at: isoDateString.optional(),
  created: isoDateString.optional(), // Legacy field
  updated: isoDateString.optional(), // Legacy field

  // Local ID
  id: z.string().min(1),

  // Legacy fields (accepted but ignored)
  type: z.string().optional(),
  priority: z.string().optional(),
  kind: z.string().optional(),
  progress: z.number().optional(),
  author: z.string().optional(),
  reviewers: z.array(z.string()).optional(),
  approved: z.boolean().optional(),
  approvedBy: z.array(z.string()).optional(),
  approvedAt: z.string().optional(),
  estimate: z.number().optional(),
  parent: z.string().optional(),
  blockedBy: z.array(z.string()).optional(),
  blocks: z.array(z.string()).optional(),
  dueDate: z.string().optional(),
  version: z.string().optional(),
  tasks: z.array(z.string()).optional(),
  issues: z.array(z.string()).optional(),
  plans: z.array(z.string()).optional(),
  reproducible: z.boolean().optional(),
  affectedVersion: z.string().optional(),
  targetVersion: z.string().optional(),
  supersedes: z.string().optional(),
  supersededBy: z.string().optional(),
}).transform((data) => {
  // Map legacy fields to new format
  const now = new Date().toISOString()

  // Get state from status if state not provided
  let state: "open" | "closed" = data.state as "open" | "closed"
  if (!state && data.status) {
    const statusMapping: Record<string, "open" | "closed"> = {
      todo: "open",
      in_progress: "open",
      blocked: "open",
      in_review: "open",
      done: "closed",
      cancelled: "closed",
    }
    state = statusMapping[data.status] || "open"
  }

  // Get assignees from assignee if assignees not provided
  let assignees = data.assignees
  if ((!assignees || assignees.length === 0) && data.assignee) {
    assignees = [data.assignee]
  }

  // Build labels from legacy fields
  const labels = [...(data.labels || [])]
  if (data.type && !labels.some(l => l.startsWith("type:"))) {
    labels.push(`type:${data.type}`)
  }
  if (data.priority && !labels.some(l => l.startsWith("priority:"))) {
    labels.push(`priority:${data.priority}`)
  }
  if (data.status && !labels.some(l => l.startsWith("status:"))) {
    labels.push(`status:${data.status}`)
  }
  if (data.kind && !labels.some(l => l === data.kind)) {
    labels.push(data.kind)
  }

  return {
    id: data.id,
    number: data.number,
    title: data.title,
    state: state || "open",
    labels,
    milestone: data.milestone,
    assignees: assignees || [],
    created_at: data.created_at || data.created || now,
    updated_at: data.updated_at || data.updated || now,
  }
})

/**
 * List options schema
 */
export const listIssuesOptionsSchema = z.object({
  type: issueTypeSchema.optional(),
  state: z.union([issueStateSchema, z.array(issueStateSchema)]).optional(),
  milestone: z.string().optional(),
  assignee: z.string().optional(),
  labels: z.array(z.string()).optional(),
  sortBy: z.enum(["created_at", "updated_at", "title"]).optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
})

// Legacy aliases for backward compatibility
export const sdlcStatusSchema = z.enum([
  "todo",
  "in_progress",
  "blocked",
  "in_review",
  "done",
  "cancelled",
])

export const sdlcPrioritySchema = z.enum([
  "low",
  "medium",
  "high",
  "critical",
])

export const sdlcResourceTypeSchema = z.enum([
  "task",
  "issue",
  "plan",
  "milestone",
  "rfc",
])

// Legacy schema - uses same permissive schema
export const sdlcResourceSchema = issueMetadataSchema

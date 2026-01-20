/**
 * Zod schemas for SDLC resource validation
 */

import { z } from "zod"

/**
 * ISO 8601 date-time string
 */
const isoDateString = z.string().datetime()

/**
 * Common SDLC statuses
 */
export const sdlcStatusSchema = z.enum([
  "todo",
  "in_progress",
  "blocked",
  "in_review",
  "done",
  "cancelled",
])

/**
 * Priority levels
 */
export const sdlcPrioritySchema = z.enum([
  "low",
  "medium",
  "high",
  "critical",
])

/**
 * Resource types
 */
export const sdlcResourceTypeSchema = z.enum([
  "task",
  "issue",
  "plan",
  "milestone",
  "rfc",
])

/**
 * Base metadata schema
 */
const baseMetadataSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(200),
  status: sdlcStatusSchema,
  created: isoDateString,
  updated: isoDateString,
  labels: z.array(z.string()).optional(),
})

/**
 * Task schema
 */
export const sdlcTaskSchema = baseMetadataSchema.extend({
  type: z.literal("task"),
  milestone: z.string().optional(),
  assignee: z.string().optional(),
  priority: sdlcPrioritySchema,
  estimate: z.number().min(0).optional(),
  parent: z.string().optional(),
  blockedBy: z.array(z.string()).optional(),
  blocks: z.array(z.string()).optional(),
})

/**
 * Issue schema
 */
export const sdlcIssueSchema = baseMetadataSchema.extend({
  type: z.literal("issue"),
  milestone: z.string().optional(),
  assignee: z.string().optional(),
  priority: sdlcPrioritySchema,
  kind: z.enum(["bug", "feature", "enhancement", "documentation"]),
  reproducible: z.boolean().optional(),
  affectedVersion: z.string().optional(),
  targetVersion: z.string().optional(),
})

/**
 * Plan schema
 */
export const sdlcPlanSchema = baseMetadataSchema.extend({
  type: z.literal("plan"),
  milestone: z.string().optional(),
  author: z.string().optional(),
  reviewers: z.array(z.string()).optional(),
  approved: z.boolean().optional(),
  approvedBy: z.array(z.string()).optional(),
  approvedAt: isoDateString.optional(),
})

/**
 * Milestone schema
 */
export const sdlcMilestoneSchema = baseMetadataSchema.extend({
  type: z.literal("milestone"),
  dueDate: isoDateString.optional(),
  version: z.string().optional(),
  progress: z.number().min(0).max(100),
  tasks: z.array(z.string()).optional(),
  issues: z.array(z.string()).optional(),
  plans: z.array(z.string()).optional(),
})

/**
 * RFC schema
 */
export const sdlcRfcSchema = baseMetadataSchema.extend({
  type: z.literal("rfc"),
  author: z.string().optional(),
  reviewers: z.array(z.string()).optional(),
  approved: z.boolean().optional(),
  approvedBy: z.array(z.string()).optional(),
  approvedAt: isoDateString.optional(),
  supersedes: z.string().optional(),
  supersededBy: z.string().optional(),
})

/**
 * Union schema for all SDLC resources
 */
export const sdlcResourceSchema = z.discriminatedUnion("type", [
  sdlcTaskSchema,
  sdlcIssueSchema,
  sdlcPlanSchema,
  sdlcMilestoneSchema,
  sdlcRfcSchema,
])

/**
 * List options schema
 */
export const listSdlcResourcesOptionsSchema = z.object({
  type: sdlcResourceTypeSchema.optional(),
  status: z
    .union([sdlcStatusSchema, z.array(sdlcStatusSchema)])
    .optional(),
  milestone: z.string().optional(),
  assignee: z.string().optional(),
  labels: z.array(z.string()).optional(),
  sortBy: z.enum(["created", "updated", "priority", "title"]).optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
})

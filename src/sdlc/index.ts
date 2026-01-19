/**
 * File-based SDLC (Software Development Lifecycle) system
 *
 * Manages tasks, issues, plans, milestones, and RFCs as markdown files
 * with YAML frontmatter, stored in `.veryfront/sdlc/`.
 *
 * @example
 * ```ts
 * import { createResource, listResources, updateResource } from "#veryfront/sdlc"
 *
 * // Create a new task
 * const task = await createResource({
 *   type: "task",
 *   metadata: {
 *     title: "Implement JWT authentication",
 *     status: "todo",
 *     priority: "high",
 *     assignee: "kentaro",
 *   },
 *   content: "## Description\n\nAdd JWT authentication to the API.",
 * })
 *
 * // List all tasks
 * const tasks = await listResources("task")
 *
 * // Update task status
 * await updateResource({
 *   type: "task",
 *   id: task.metadata.id,
 *   metadata: { status: "in_progress" },
 * })
 * ```
 */

export * from "./types.ts"
export * from "./schema.ts"
export * from "./core.ts"

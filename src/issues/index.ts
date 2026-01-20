/**
 * File-based issues system - GitHub compatible
 *
 * Manages issues, plans, and milestones as markdown files
 * with YAML frontmatter, stored in `issues/` folder.
 * Supports bi-directional sync with GitHub Issues.
 *
 * @example
 * ```ts
 * import { createResource, listAllResources, sync } from "#veryfront/issues"
 *
 * // Create a new issue
 * const issue = await createResource({
 *   title: "Fix login bug",
 *   type: "issue",
 *   labels: ["bug", "priority:high"],
 *   assignees: ["kentaro"],
 *   content: "## Description\n\nLogin fails on Safari.",
 * })
 *
 * // List all issues
 * const issues = await listAllResources()
 *
 * // Sync with GitHub
 * const stats = await sync({ owner: "org", repo: "repo", token: "..." }, ".")
 * ```
 */

export * from "./types.ts"
export * from "./schema.ts"
export * from "./core.ts"
export * from "./sync.ts"

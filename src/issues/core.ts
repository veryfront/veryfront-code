/**
 * Core issues library - GitHub compatible file-based issue tracking
 */

import * as path from "#std/path.ts"
import matter from "gray-matter"
import type {
  CreateIssueOptions,
  ListIssuesOptions,
  UpdateIssueOptions,
  IssueMetadata,
  IssueFile,
  IssueType,
  IssueState,
  IssueStats,
} from "./types.ts"
import { issueMetadataSchema } from "./schema.ts"

// Legacy type aliases for CLI compatibility during migration
export type SdlcResourceType = IssueType | "task" | "rfc"
export type SdlcStatus = "todo" | "in_progress" | "blocked" | "in_review" | "done" | "cancelled"
export type SdlcPriority = "low" | "medium" | "high" | "critical"

/**
 * Base directory for issues - flat structure in issues/
 */
export const SDLC_BASE_DIR = "issues"

/**
 * Get the directory path for issues (flat structure)
 */
export function getResourceDir(basePath = "."): string {
  return path.join(basePath, SDLC_BASE_DIR)
}

/**
 * Get the file path for an issue
 */
export function getResourcePath(id: string, basePath = "."): string {
  return path.join(getResourceDir(basePath), `${id}.md`)
}

/**
 * Generate a new issue ID
 */
export function generateResourceId(type: IssueType): string {
  const prefix = type.toUpperCase()
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(2, 8)
  return `${prefix}-${timestamp}-${random}`
}

/**
 * Parse markdown file with frontmatter
 */
export function parseResourceFile(content: string): {
  metadata: unknown
  content: string
} {
  const parsed = matter(content)
  return {
    metadata: parsed.data,
    content: parsed.content.trim(),
  }
}

/**
 * Serialize issue to markdown with frontmatter
 */
export function serializeResourceFile(
  metadata: IssueMetadata,
  content: string,
): string {
  return matter.stringify(content, metadata)
}

/**
 * Read a single issue
 */
export async function readResource(
  id: string,
  basePath = ".",
): Promise<IssueFile | null> {
  try {
    const filePath = getResourcePath(id, basePath)
    const fileContent = await Deno.readTextFile(filePath)
    const { metadata, content } = parseResourceFile(fileContent)

    // Validate and coerce metadata
    const validatedMetadata = issueMetadataSchema.parse(metadata)

    return {
      metadata: validatedMetadata,
      content,
      path: filePath,
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return null
    }
    throw error
  }
}

/**
 * List all issues from the flat issues/ directory
 */
export async function listAllResources(basePath = "."): Promise<IssueFile[]> {
  const dir = getResourceDir(basePath)

  try {
    const files: IssueFile[] = []

    for await (const entry of Deno.readDir(dir)) {
      if (entry.isFile && entry.name.endsWith(".md")) {
        const id = entry.name.replace(/\.md$/, "")
        const resource = await readResource(id, basePath)
        if (resource) {
          files.push(resource)
        }
      }
    }

    return files
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return []
    }
    throw error
  }
}

/**
 * List issues of a specific type (by label)
 */
export async function listResources(
  type: IssueType,
  basePath = ".",
): Promise<IssueFile[]> {
  const allResources = await listAllResources(basePath)
  return allResources.filter((r) => r.metadata.labels.includes(`type:${type}`))
}

/**
 * Filter issues based on options
 */
export function filterResources(
  resources: IssueFile[],
  options: ListIssuesOptions,
): IssueFile[] {
  let filtered = [...resources]

  // Filter by type (via label)
  if (options.type) {
    filtered = filtered.filter((r) =>
      r.metadata.labels.includes(`type:${options.type}`)
    )
  }

  // Filter by state
  if (options.state) {
    const states = Array.isArray(options.state) ? options.state : [options.state]
    filtered = filtered.filter((r) => states.includes(r.metadata.state))
  }

  // Filter by milestone
  if (options.milestone) {
    filtered = filtered.filter((r) => r.metadata.milestone === options.milestone)
  }

  // Filter by assignee
  if (options.assignee) {
    filtered = filtered.filter((r) =>
      r.metadata.assignees.includes(options.assignee!)
    )
  }

  // Filter by labels
  if (options.labels && options.labels.length > 0) {
    filtered = filtered.filter((r) =>
      options.labels!.every((label) => r.metadata.labels.includes(label))
    )
  }

  // Sort
  if (options.sortBy) {
    filtered.sort((a, b) => {
      const sortKey = options.sortBy!
      const aVal = a.metadata[sortKey]
      const bVal = b.metadata[sortKey]

      if (aVal === undefined || bVal === undefined) return 0

      let comparison = 0
      if (typeof aVal === "string" && typeof bVal === "string") {
        comparison = aVal.localeCompare(bVal)
      }

      return options.sortOrder === "desc" ? -comparison : comparison
    })
  }

  return filtered
}

/**
 * Create a new issue
 */
export async function createResource(
  options: CreateIssueOptions,
  basePath = ".",
): Promise<IssueFile> {
  const { title, type = "issue", labels = [], milestone, assignees = [], content } = options

  // Generate ID
  const id = generateResourceId(type)

  // Build labels array (include type as label)
  const allLabels = [...labels]
  if (!allLabels.includes(`type:${type}`)) {
    allLabels.push(`type:${type}`)
  }

  // Create full metadata
  const now = new Date().toISOString()
  const metadata: IssueMetadata = {
    id,
    title,
    state: "open",
    labels: allLabels,
    milestone,
    assignees,
    created_at: now,
    updated_at: now,
  }

  // Validate metadata
  const validatedMetadata = issueMetadataSchema.parse(metadata)

  // Serialize to file
  const fileContent = serializeResourceFile(validatedMetadata, content)
  const filePath = getResourcePath(id, basePath)

  // Ensure directory exists
  const dir = path.dirname(filePath)
  await Deno.mkdir(dir, { recursive: true })

  // Write file
  await Deno.writeTextFile(filePath, fileContent)

  return {
    metadata: validatedMetadata,
    content,
    path: filePath,
  }
}

/**
 * Update an existing issue
 */
export async function updateResource(
  options: UpdateIssueOptions,
  basePath = ".",
): Promise<IssueFile | null> {
  const { id, ...updates } = options

  // Read existing issue
  const existing = await readResource(id, basePath)
  if (!existing) {
    return null
  }

  // Merge metadata
  const updatedMetadata: IssueMetadata = {
    ...existing.metadata,
    ...updates,
    updated_at: new Date().toISOString(),
  }

  // Handle content update
  if (updates.content !== undefined) {
    delete (updatedMetadata as any).content
  }

  // Validate
  const validatedMetadata = issueMetadataSchema.parse(updatedMetadata)

  // Serialize
  const updatedContent = updates.content ?? existing.content
  const fileContent = serializeResourceFile(validatedMetadata, updatedContent)

  // Write
  await Deno.writeTextFile(existing.path, fileContent)

  return {
    metadata: validatedMetadata,
    content: updatedContent,
    path: existing.path,
  }
}

/**
 * Delete an issue
 */
export async function deleteResource(id: string, basePath = "."): Promise<boolean> {
  try {
    const filePath = getResourcePath(id, basePath)
    await Deno.remove(filePath)
    return true
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return false
    }
    throw error
  }
}

/**
 * Get statistics for issues
 */
export async function getStats(basePath = "."): Promise<IssueStats> {
  const allResources = await listAllResources(basePath)

  const stats: IssueStats = {
    total: allResources.length,
    byState: {
      open: 0,
      closed: 0,
    },
    byType: {
      issue: 0,
      plan: 0,
      milestone: 0,
    },
  }

  for (const resource of allResources) {
    stats.byState[resource.metadata.state]++

    // Count by type label
    if (resource.metadata.labels.includes("type:issue")) stats.byType.issue++
    else if (resource.metadata.labels.includes("type:plan")) stats.byType.plan++
    else if (resource.metadata.labels.includes("type:milestone")) stats.byType.milestone++
    else stats.byType.issue++ // default to issue
  }

  return stats
}

/**
 * Auto-discover all issues in a project
 */
export async function discoverResources(basePath = "."): Promise<{
  resources: IssueFile[]
  stats: IssueStats
}> {
  const resources = await listAllResources(basePath)
  const stats = await getStats(basePath)

  return { resources, stats }
}

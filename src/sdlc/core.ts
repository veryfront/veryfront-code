/**
 * Core SDLC library for managing file-based resources
 */

import * as path from "#std/path.ts"
import matter from "gray-matter"
import type {
  CreateSdlcResourceOptions,
  ListSdlcResourcesOptions,
  SdlcResource,
  SdlcResourceFile,
  SdlcResourceType,
  SdlcStats,
  SdlcStatus,
  UpdateSdlcResourceOptions,
} from "./types.ts"
import { sdlcResourceSchema } from "./schema.ts"

/**
 * Base directory for SDLC resources
 */
export const SDLC_BASE_DIR = ".veryfront/sdlc"

/**
 * Subdirectories for each resource type
 */
const RESOURCE_DIRS: Record<SdlcResourceType, string> = {
  task: "tasks",
  issue: "issues",
  plan: "plans",
  milestone: "milestones",
  rfc: "rfcs",
}

/**
 * Get the directory path for a resource type
 */
export function getResourceDir(
  type: SdlcResourceType,
  basePath = ".",
): string {
  return path.join(basePath, SDLC_BASE_DIR, RESOURCE_DIRS[type])
}

/**
 * Get the file path for a resource
 */
export function getResourcePath(
  type: SdlcResourceType,
  id: string,
  basePath = ".",
): string {
  return path.join(getResourceDir(type, basePath), `${id}.md`)
}

/**
 * Generate a new resource ID
 */
export function generateResourceId(type: SdlcResourceType): string {
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
 * Serialize resource to markdown with frontmatter
 */
export function serializeResourceFile(
  metadata: SdlcResource,
  content: string,
): string {
  return matter.stringify(content, metadata)
}

/**
 * Read a single SDLC resource
 */
export async function readResource(
  type: SdlcResourceType,
  id: string,
  basePath = ".",
): Promise<SdlcResourceFile | null> {
  try {
    const filePath = getResourcePath(type, id, basePath)
    const fileContent = await Deno.readTextFile(filePath)
    const { metadata, content } = parseResourceFile(fileContent)

    // Validate metadata
    const validatedMetadata = sdlcResourceSchema.parse(metadata)

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
 * List all resources of a given type
 */
export async function listResources(
  type: SdlcResourceType,
  basePath = ".",
): Promise<SdlcResourceFile[]> {
  const dir = getResourceDir(type, basePath)

  try {
    const files: SdlcResourceFile[] = []

    for await (const entry of Deno.readDir(dir)) {
      if (entry.isFile && entry.name.endsWith(".md")) {
        const id = entry.name.replace(/\.md$/, "")
        const resource = await readResource(type, id, basePath)
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
 * List all resources across all types
 */
export async function listAllResources(
  basePath = ".",
): Promise<SdlcResourceFile[]> {
  const types: SdlcResourceType[] = ["task", "issue", "plan", "milestone", "rfc"]
  const allResources: SdlcResourceFile[] = []

  for (const type of types) {
    const resources = await listResources(type, basePath)
    allResources.push(...resources)
  }

  return allResources
}

/**
 * Filter resources based on options
 */
export function filterResources(
  resources: SdlcResourceFile[],
  options: ListSdlcResourcesOptions,
): SdlcResourceFile[] {
  let filtered = [...resources]

  // Filter by type
  if (options.type) {
    filtered = filtered.filter((r) => r.metadata.type === options.type)
  }

  // Filter by status
  if (options.status) {
    const statuses = Array.isArray(options.status)
      ? options.status
      : [options.status]
    filtered = filtered.filter((r) => statuses.includes(r.metadata.status))
  }

  // Filter by milestone
  if (options.milestone) {
    filtered = filtered.filter(
      (r) => "milestone" in r.metadata && r.metadata.milestone === options.milestone,
    )
  }

  // Filter by assignee
  if (options.assignee) {
    filtered = filtered.filter(
      (r) => "assignee" in r.metadata && r.metadata.assignee === options.assignee,
    )
  }

  // Filter by labels
  if (options.labels && options.labels.length > 0) {
    filtered = filtered.filter((r) =>
      options.labels!.every((label) =>
        r.metadata.labels?.includes(label)
      )
    )
  }

  // Sort
  if (options.sortBy) {
    filtered.sort((a, b) => {
      const sortKey = options.sortBy!
      const aVal = (a.metadata as any)[sortKey]
      const bVal = (b.metadata as any)[sortKey]

      if (aVal === undefined || bVal === undefined) return 0

      let comparison = 0
      if (typeof aVal === "string" && typeof bVal === "string") {
        comparison = aVal.localeCompare(bVal)
      } else if (typeof aVal === "number" && typeof bVal === "number") {
        comparison = aVal - bVal
      }

      return options.sortOrder === "desc" ? -comparison : comparison
    })
  }

  return filtered
}

/**
 * Create a new SDLC resource
 */
export async function createResource<T extends SdlcResource>(
  options: CreateSdlcResourceOptions<T>,
  basePath = ".",
): Promise<SdlcResourceFile<T>> {
  const { type, metadata, content } = options

  // Generate ID if not provided
  const id = metadata.id || generateResourceId(type)

  // Create full metadata with timestamps
  const now = new Date().toISOString()
  const fullMetadata = {
    ...metadata,
    id,
    type,
    created: now,
    updated: now,
  } as T

  // Validate metadata
  const validatedMetadata = sdlcResourceSchema.parse(fullMetadata) as T

  // Serialize to file
  const fileContent = serializeResourceFile(validatedMetadata, content)
  const filePath = getResourcePath(type, id, basePath)

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
 * Update an existing SDLC resource
 */
export async function updateResource(
  options: UpdateSdlcResourceOptions,
  basePath = ".",
): Promise<SdlcResourceFile | null> {
  const { id, type, metadata, content } = options

  // Read existing resource
  const existing = await readResource(type, id, basePath)
  if (!existing) {
    return null
  }

  // Merge metadata
  const updatedMetadata = {
    ...existing.metadata,
    ...metadata,
    updated: new Date().toISOString(),
  }

  // Validate
  const validatedMetadata = sdlcResourceSchema.parse(updatedMetadata)

  // Serialize
  const updatedContent = content ?? existing.content
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
 * Delete an SDLC resource
 */
export async function deleteResource(
  type: SdlcResourceType,
  id: string,
  basePath = ".",
): Promise<boolean> {
  try {
    const filePath = getResourcePath(type, id, basePath)
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
 * Get statistics for SDLC resources
 */
export async function getStats(basePath = "."): Promise<SdlcStats> {
  const allResources = await listAllResources(basePath)

  const stats: SdlcStats = {
    total: allResources.length,
    byStatus: {
      todo: 0,
      in_progress: 0,
      blocked: 0,
      in_review: 0,
      done: 0,
      cancelled: 0,
    },
    byType: {
      task: 0,
      issue: 0,
      plan: 0,
      milestone: 0,
      rfc: 0,
    },
    byPriority: {
      low: 0,
      medium: 0,
      high: 0,
      critical: 0,
    },
  }

  for (const resource of allResources) {
    stats.byStatus[resource.metadata.status]++
    stats.byType[resource.metadata.type]++

    if ("priority" in resource.metadata) {
      stats.byPriority[resource.metadata.priority]++
    }
  }

  return stats
}

/**
 * Auto-discover all SDLC resources in a project
 */
export async function discoverResources(
  basePath = ".",
): Promise<{
  resources: SdlcResourceFile[]
  stats: SdlcStats
}> {
  const resources = await listAllResources(basePath)
  const stats = await getStats(basePath)

  return { resources, stats }
}

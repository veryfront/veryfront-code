/**
 * Unit tests for SDLC core library
 * @module sdlc/core.test
 */

import { assertEquals, assertExists } from "#veryfront/testing/assert.ts"
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts"
import {
  createResource,
  deleteResource,
  discoverResources,
  filterResources,
  generateResourceId,
  getResourceDir,
  getResourcePath,
  getStats,
  listAllResources,
  listResources,
  parseResourceFile,
  readResource,
  serializeResourceFile,
  SDLC_BASE_DIR,
  updateResource,
} from "./core.ts"
import type { SdlcTask, SdlcIssue } from "./types.ts"

const TEST_DIR = "./test-sdlc-temp"

describe("SDLC Core Library", () => {
  beforeEach(async () => {
    // Clean up test directory before each test
    try {
      await Deno.remove(TEST_DIR, { recursive: true })
    } catch {
      // Ignore if doesn't exist
    }
  })

  afterEach(async () => {
    // Clean up after each test
    try {
      await Deno.remove(TEST_DIR, { recursive: true })
    } catch {
      // Ignore errors
    }
  })

  describe("Path utilities", () => {
    it("should generate correct resource directory", () => {
      const dir = getResourceDir(TEST_DIR)
      assertEquals(dir.endsWith(SDLC_BASE_DIR), true)
    })

    it("should generate correct resource path", () => {
      const path = getResourcePath("TASK-001", TEST_DIR)
      assertEquals(path.endsWith(`${SDLC_BASE_DIR}/TASK-001.md`), true)
    })

    it("should generate unique resource IDs", () => {
      const id1 = generateResourceId("task")
      const id2 = generateResourceId("task")

      assertEquals(id1.startsWith("TASK-"), true)
      assertEquals(id2.startsWith("TASK-"), true)
      assertEquals(id1 !== id2, true)
    })
  })

  describe("Serialization", () => {
    it("should serialize and parse resource files", () => {
      const metadata: SdlcTask = {
        type: "task",
        id: "TASK-001",
        title: "Test task",
        status: "todo",
        priority: "high",
        created: "2024-01-01T00:00:00Z",
        updated: "2024-01-01T00:00:00Z",
      }
      const content = "# Test Task\n\nThis is a test."

      const serialized = serializeResourceFile(metadata, content)
      const parsed = parseResourceFile(serialized)

      assertEquals(parsed.metadata, metadata)
      assertEquals(parsed.content, content)
    })

    it("should handle metadata with arrays", () => {
      const metadata: SdlcTask = {
        type: "task",
        id: "TASK-002",
        title: "Test task with arrays",
        status: "todo",
        priority: "medium",
        created: "2024-01-01T00:00:00Z",
        updated: "2024-01-01T00:00:00Z",
        labels: ["bug", "urgent"],
        blockedBy: ["TASK-001"],
      }
      const content = "Test content"

      const serialized = serializeResourceFile(metadata, content)
      const parsed = parseResourceFile(serialized)

      assertEquals(parsed.metadata, metadata)
    })
  })

  describe("CRUD operations", () => {
    it("should create a task", async () => {
      const task = await createResource<SdlcTask>(
        {
          type: "task",
          metadata: {
            id: "TASK-001",
            title: "Implement authentication",
            status: "todo",
            priority: "high",
          },
          content: "# Authentication\n\nImplement JWT authentication.",
        },
        TEST_DIR,
      )

      assertExists(task)
      assertEquals(task.metadata.type, "task")
      assertEquals(task.metadata.title, "Implement authentication")
      assertEquals(task.metadata.status, "todo")
      assertEquals(task.metadata.priority, "high")
      assertExists(task.metadata.created)
      assertExists(task.metadata.updated)
    })

    it("should create an issue", async () => {
      const issue = await createResource<SdlcIssue>(
        {
          type: "issue",
          metadata: {
            id: "ISSUE-001",
            title: "Login bug",
            status: "todo",
            priority: "critical",
            kind: "bug",
          },
          content: "# Login Bug\n\nUsers cannot log in.",
        },
        TEST_DIR,
      )

      assertEquals(issue.metadata.type, "issue")
      assertEquals(issue.metadata.kind, "bug")
    })

    it("should read a created resource", async () => {
      await createResource<SdlcTask>(
        {
          type: "task",
          metadata: {
            id: "TASK-001",
            title: "Test task",
            status: "todo",
            priority: "low",
          },
          content: "Test content",
        },
        TEST_DIR,
      )

      const resource = await readResource("TASK-001", TEST_DIR)
      assertExists(resource)
      assertEquals(resource.metadata.title, "Test task")
      assertEquals(resource.content, "Test content")
    })

    it("should return null for non-existent resource", async () => {
      const resource = await readResource("NONEXISTENT", TEST_DIR)
      assertEquals(resource, null)
    })

    it("should update a resource", async () => {
      await createResource<SdlcTask>(
        {
          type: "task",
          metadata: {
            id: "TASK-001",
            title: "Original title",
            status: "todo",
            priority: "low",
          },
          content: "Original content",
        },
        TEST_DIR,
      )

      const updated = await updateResource(
        {
          id: "TASK-001",
          metadata: {
            status: "in_progress",
            title: "Updated title",
          },
        },
        TEST_DIR,
      )

      assertExists(updated)
      assertEquals(updated.metadata.status, "in_progress")
      assertEquals(updated.metadata.title, "Updated title")
      if ("priority" in updated.metadata) {
        assertEquals(updated.metadata.priority, "low") // Unchanged
      }
    })

    it("should delete a resource", async () => {
      await createResource<SdlcTask>(
        {
          type: "task",
          metadata: {
            id: "TASK-001",
            title: "To be deleted",
            status: "todo",
            priority: "low",
          },
          content: "Delete me",
        },
        TEST_DIR,
      )

      const deleted = await deleteResource("TASK-001", TEST_DIR)
      assertEquals(deleted, true)

      const resource = await readResource("TASK-001", TEST_DIR)
      assertEquals(resource, null)
    })

    it("should return false when deleting non-existent resource", async () => {
      const deleted = await deleteResource("NONEXISTENT", TEST_DIR)
      assertEquals(deleted, false)
    })
  })

  describe("List and filter operations", () => {
    beforeEach(async () => {
      // Create test resources
      await createResource<SdlcTask>(
        {
          type: "task",
          metadata: {
            id: "TASK-001",
            title: "Task 1",
            status: "todo",
            priority: "high",
            milestone: "v1.0",
            assignee: "alice",
          },
          content: "Task 1 content",
        },
        TEST_DIR,
      )

      await createResource<SdlcTask>(
        {
          type: "task",
          metadata: {
            id: "TASK-002",
            title: "Task 2",
            status: "in_progress",
            priority: "low",
            assignee: "bob",
          },
          content: "Task 2 content",
        },
        TEST_DIR,
      )

      await createResource<SdlcIssue>(
        {
          type: "issue",
          metadata: {
            id: "ISSUE-001",
            title: "Issue 1",
            status: "todo",
            priority: "critical",
            kind: "bug",
            milestone: "v1.0",
          },
          content: "Issue 1 content",
        },
        TEST_DIR,
      )
    })

    it("should list resources by type", async () => {
      const tasks = await listResources("task", TEST_DIR)
      assertEquals(tasks.length, 2)

      const issues = await listResources("issue", TEST_DIR)
      assertEquals(issues.length, 1)
    })

    it("should list all resources", async () => {
      const all = await listAllResources(TEST_DIR)
      assertEquals(all.length, 3)
    })

    it("should filter by status", async () => {
      const all = await listAllResources(TEST_DIR)
      const filtered = filterResources(all, { status: "todo" })
      assertEquals(filtered.length, 2)
    })

    it("should filter by multiple statuses", async () => {
      const all = await listAllResources(TEST_DIR)
      const filtered = filterResources(all, { status: ["todo", "in_progress"] })
      assertEquals(filtered.length, 3)
    })

    it("should filter by milestone", async () => {
      const all = await listAllResources(TEST_DIR)
      const filtered = filterResources(all, { milestone: "v1.0" })
      assertEquals(filtered.length, 2)
    })

    it("should filter by assignee", async () => {
      const all = await listAllResources(TEST_DIR)
      const filtered = filterResources(all, { assignee: "alice" })
      assertEquals(filtered.length, 1)
      assertEquals(filtered[0]!.metadata.title, "Task 1")
    })

    it("should filter by type", async () => {
      const all = await listAllResources(TEST_DIR)
      const filtered = filterResources(all, { type: "task" })
      assertEquals(filtered.length, 2)
    })

    it("should sort by title ascending", async () => {
      const all = await listAllResources(TEST_DIR)
      const filtered = filterResources(all, { sortBy: "title", sortOrder: "asc" })
      assertEquals(filtered[0]!.metadata.title, "Issue 1")
    })

    it("should sort by title descending", async () => {
      const all = await listAllResources(TEST_DIR)
      const filtered = filterResources(all, { sortBy: "title", sortOrder: "desc" })
      assertEquals(filtered[0]!.metadata.title, "Task 2")
    })
  })

  describe("Statistics", () => {
    beforeEach(async () => {
      await createResource<SdlcTask>(
        {
          type: "task",
          metadata: {
            id: "TASK-001",
            title: "Task 1",
            status: "todo",
            priority: "high",
          },
          content: "Content",
        },
        TEST_DIR,
      )

      await createResource<SdlcTask>(
        {
          type: "task",
          metadata: {
            id: "TASK-002",
            title: "Task 2",
            status: "done",
            priority: "low",
          },
          content: "Content",
        },
        TEST_DIR,
      )

      await createResource<SdlcIssue>(
        {
          type: "issue",
          metadata: {
            id: "ISSUE-001",
            title: "Issue 1",
            status: "in_progress",
            priority: "critical",
            kind: "bug",
          },
          content: "Content",
        },
        TEST_DIR,
      )
    })

    it("should calculate statistics", async () => {
      const stats = await getStats(TEST_DIR)

      assertEquals(stats.total, 3)
      assertEquals(stats.byType.task, 2)
      assertEquals(stats.byType.issue, 1)
      assertEquals(stats.byStatus.todo, 1)
      assertEquals(stats.byStatus.done, 1)
      assertEquals(stats.byStatus.in_progress, 1)
      assertEquals(stats.byPriority.high, 1)
      assertEquals(stats.byPriority.low, 1)
      assertEquals(stats.byPriority.critical, 1)
    })
  })

  describe("Auto-discovery", () => {
    it("should discover all resources with statistics", async () => {
      await createResource<SdlcTask>(
        {
          type: "task",
          metadata: {
            id: "TASK-001",
            title: "Task 1",
            status: "todo",
            priority: "high",
          },
          content: "Content",
        },
        TEST_DIR,
      )

      const { resources, stats } = await discoverResources(TEST_DIR)

      assertEquals(resources.length, 1)
      assertEquals(stats.total, 1)
      assertEquals(stats.byType.task, 1)
    })

    it("should return empty results for non-existent directory", async () => {
      const { resources, stats } = await discoverResources("./nonexistent")

      assertEquals(resources.length, 0)
      assertEquals(stats.total, 0)
    })
  })
})

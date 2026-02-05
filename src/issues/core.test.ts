/**
 * Tests for the issues core module
 *
 * @module issues/core.test
 */

import { assertEquals, assertExists } from "#std/assert.ts";
import { join } from "#std/path.ts";
import {
  createIssuesManager,
  parseFrontmatter,
  parseIssue,
  parseYaml,
  serializeIssue,
  serializeYaml,
} from "./core.ts";
import type { Issue, IssueMetadata } from "./schemas/index.ts";

// ============================================================================
// YAML Parser Tests
// ============================================================================

Deno.test("parseYaml - parses scalar values", () => {
  const yaml = `
id: ISSUE-001
title: "Fix login bug"
state: open
`;
  const result = parseYaml(yaml);
  assertEquals(result.id, "ISSUE-001");
  assertEquals(result.title, "Fix login bug");
  assertEquals(result.state, "open");
});

Deno.test("parseYaml - parses inline arrays", () => {
  const yaml = `
labels: [bug, "priority:high"]
assignees: []
`;
  const result = parseYaml(yaml);
  assertEquals(result.labels, ["bug", "priority:high"]);
  assertEquals(result.assignees, []);
});

Deno.test("parseYaml - parses block arrays", () => {
  const yaml = `
labels:
  - bug
  - "priority:high"
  - wontfix
`;
  const result = parseYaml(yaml);
  assertEquals(result.labels, ["bug", "priority:high", "wontfix"]);
});

Deno.test("parseYaml - handles booleans", () => {
  const yaml = `
active: true
hidden: false
`;
  const result = parseYaml(yaml);
  assertEquals(result.active, true);
  assertEquals(result.hidden, false);
});

Deno.test("parseYaml - handles null/undefined", () => {
  const yaml = `
milestone: null
parent: ~
`;
  const result = parseYaml(yaml);
  assertEquals(result.milestone, undefined);
  assertEquals(result.parent, undefined);
});

// ============================================================================
// Frontmatter Parser Tests
// ============================================================================

Deno.test("parseFrontmatter - extracts frontmatter and body", () => {
  const content = `---
id: ISSUE-001
title: Test
---

This is the body.
`;
  const result = parseFrontmatter(content);
  assertExists(result);
  assertEquals(result.frontmatter, "id: ISSUE-001\ntitle: Test");
  assertEquals(result.body, "This is the body.");
});

Deno.test("parseFrontmatter - returns null for invalid content", () => {
  const result = parseFrontmatter("No frontmatter here");
  assertEquals(result, null);
});

// ============================================================================
// Serialization Tests
// ============================================================================

Deno.test("serializeYaml - produces valid YAML", () => {
  const metadata: IssueMetadata = {
    id: "ISSUE-001",
    title: "Test issue",
    state: "open",
    labels: ["bug", "priority:high"],
    assignees: ["alice"],
    created_at: "2026-01-23T00:00:00.000Z",
    updated_at: "2026-01-23T00:00:00.000Z",
  };

  const yaml = serializeYaml(metadata);
  assertEquals(yaml.includes("id: ISSUE-001"), true);
  assertEquals(yaml.includes('title: "Test issue"'), true);
  assertEquals(yaml.includes("state: open"), true);
  assertEquals(yaml.includes('labels: ["bug", "priority:high"]'), true);
  assertEquals(yaml.includes('assignees: ["alice"]'), true);
});

Deno.test("serializeIssue - produces valid markdown with frontmatter", () => {
  const issue: Issue = {
    metadata: {
      id: "ISSUE-001",
      title: "Test issue",
      state: "open",
      labels: [],
      assignees: [],
      created_at: "2026-01-23T00:00:00.000Z",
      updated_at: "2026-01-23T00:00:00.000Z",
    },
    body: "## Description\n\nThis is a test.",
    path: "issues/ISSUE-001.md",
  };

  const content = serializeIssue(issue);
  assertEquals(content.startsWith("---\n"), true);
  assertEquals(content.includes("---\n\n## Description"), true);
});

// ============================================================================
// Issue Parser Tests
// ============================================================================

Deno.test("parseIssue - parses valid issue markdown", () => {
  const content = `---
id: ISSUE-001
title: "Fix login timeout"
state: open
labels: [bug]
assignees: [alice]
created_at: 2026-01-23T00:00:00.000Z
updated_at: 2026-01-23T00:00:00.000Z
---

## Description

The login page times out.
`;

  const issue = parseIssue(content, "issues/ISSUE-001.md");
  assertExists(issue);
  assertEquals(issue.metadata.id, "ISSUE-001");
  assertEquals(issue.metadata.title, "Fix login timeout");
  assertEquals(issue.metadata.state, "open");
  assertEquals(issue.metadata.labels, ["bug"]);
  assertEquals(issue.metadata.assignees, ["alice"]);
  assertEquals(issue.body.includes("login page times out"), true);
});

Deno.test("parseIssue - returns null for invalid content", () => {
  const issue = parseIssue("Not a valid issue file", "invalid.md");
  assertEquals(issue, null);
});

// ============================================================================
// IssuesManager Tests (using temp directory)
// ============================================================================

function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  return Deno.makeTempDir({ prefix: "issues-test-" }).then(async (dir) => {
    try {
      await fn(dir);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  });
}

Deno.test("IssuesManager.create - creates new issue", async () => {
  await withTempDir(async (dir) => {
    const manager = createIssuesManager(dir);

    const issue = await manager.create({
      title: "Test issue",
      labels: ["bug"],
    });

    assertEquals(issue.metadata.id, "ISSUE-001");
    assertEquals(issue.metadata.title, "Test issue");
    assertEquals(issue.metadata.state, "open");
    assertEquals(issue.metadata.labels, ["bug"]);
    assertEquals(issue.path, "issues/ISSUE-001.md");

    const stat = await Deno.stat(join(dir, issue.path));
    assertEquals(stat.isFile, true);
  });
});

Deno.test("IssuesManager.create - auto-increments IDs", async () => {
  await withTempDir(async (dir) => {
    const manager = createIssuesManager(dir);

    const issue1 = await manager.create({ title: "First" });
    const issue2 = await manager.create({ title: "Second" });
    const issue3 = await manager.create({ title: "Third" });

    assertEquals(issue1.metadata.id, "ISSUE-001");
    assertEquals(issue2.metadata.id, "ISSUE-002");
    assertEquals(issue3.metadata.id, "ISSUE-003");
  });
});

Deno.test("IssuesManager.create - supports different prefixes", async () => {
  await withTempDir(async (dir) => {
    const manager = createIssuesManager(dir);

    const issue = await manager.create({ title: "Bug", prefix: "ISSUE" });
    const task = await manager.create({ title: "Task", prefix: "TASK" });
    const plan = await manager.create({ title: "Plan", prefix: "PLAN" });

    assertEquals(issue.metadata.id, "ISSUE-001");
    assertEquals(task.metadata.id, "TASK-001");
    assertEquals(plan.metadata.id, "PLAN-001");
  });
});

Deno.test("IssuesManager.get - retrieves existing issue", async () => {
  await withTempDir(async (dir) => {
    const manager = createIssuesManager(dir);
    const created = await manager.create({ title: "Test", body: "Hello" });

    const retrieved = await manager.get(created.metadata.id);
    assertExists(retrieved);
    assertEquals(retrieved.metadata.title, "Test");
    assertEquals(retrieved.body, "Hello");
  });
});

Deno.test("IssuesManager.get - returns null for non-existent issue", async () => {
  await withTempDir(async (dir) => {
    const manager = createIssuesManager(dir);
    assertEquals(await manager.get("ISSUE-999"), null);
  });
});

Deno.test("IssuesManager.update - updates issue fields", async () => {
  await withTempDir(async (dir) => {
    const manager = createIssuesManager(dir);
    const created = await manager.create({ title: "Original" });

    const updated = await manager.update(created.metadata.id, {
      title: "Updated",
      labels: ["new-label"],
    });

    assertExists(updated);
    assertEquals(updated.metadata.title, "Updated");
    assertEquals(updated.metadata.labels, ["new-label"]);
  });
});

Deno.test("IssuesManager.update - returns null for non-existent issue", async () => {
  await withTempDir(async (dir) => {
    const manager = createIssuesManager(dir);
    assertEquals(await manager.update("ISSUE-999", { title: "Test" }), null);
  });
});

Deno.test("IssuesManager.delete - removes issue file", async () => {
  await withTempDir(async (dir) => {
    const manager = createIssuesManager(dir);
    const created = await manager.create({ title: "To delete" });

    assertEquals(await manager.delete(created.metadata.id), true);
    assertEquals(await manager.get(created.metadata.id), null);
  });
});

Deno.test("IssuesManager.delete - returns false for non-existent issue", async () => {
  await withTempDir(async (dir) => {
    const manager = createIssuesManager(dir);
    assertEquals(await manager.delete("ISSUE-999"), false);
  });
});

Deno.test("IssuesManager.list - returns all issues", async () => {
  await withTempDir(async (dir) => {
    const manager = createIssuesManager(dir);
    await manager.create({ title: "First" });
    await manager.create({ title: "Second" });
    await manager.create({ title: "Third" });

    const result = await manager.list();
    assertEquals(result.total, 3);
    assertEquals(result.issues.length, 3);
  });
});

Deno.test("IssuesManager.list - filters by state", async () => {
  await withTempDir(async (dir) => {
    const manager = createIssuesManager(dir);
    const issue1 = await manager.create({ title: "Open 1" });
    const issue2 = await manager.create({ title: "Open 2" });
    await manager.close(issue1.metadata.id);

    const open = await manager.list({ state: "open" });
    assertEquals(open.total, 1);
    assertExists(open.issues[0]);
    assertEquals(open.issues[0].metadata.id, issue2.metadata.id);

    const closed = await manager.list({ state: "closed" });
    assertEquals(closed.total, 1);
    assertExists(closed.issues[0]);
    assertEquals(closed.issues[0].metadata.id, issue1.metadata.id);
  });
});

Deno.test("IssuesManager.list - filters by labels", async () => {
  await withTempDir(async (dir) => {
    const manager = createIssuesManager(dir);
    await manager.create({ title: "Bug", labels: ["bug"] });
    await manager.create({ title: "Feature", labels: ["feature"] });
    await manager.create({ title: "Bug + High", labels: ["bug", "priority:high"] });

    assertEquals((await manager.list({ labels: ["bug"] })).total, 2);
    assertEquals((await manager.list({ labels: ["bug", "priority:high"] })).total, 1);
  });
});

Deno.test("IssuesManager.list - filters by prefix", async () => {
  await withTempDir(async (dir) => {
    const manager = createIssuesManager(dir);
    await manager.create({ title: "Issue", prefix: "ISSUE" });
    await manager.create({ title: "Task 1", prefix: "TASK" });
    await manager.create({ title: "Task 2", prefix: "TASK" });

    assertEquals((await manager.list({ prefix: "ISSUE" })).total, 1);
    assertEquals((await manager.list({ prefix: "TASK" })).total, 2);
  });
});

Deno.test("IssuesManager.list - sorts by created_at", async () => {
  await withTempDir(async (dir) => {
    const manager = createIssuesManager(dir);
    await manager.create({ title: "First" });
    // Small delay to ensure different timestamps
    await new Promise((r) => setTimeout(r, 10));
    await manager.create({ title: "Second" });
    await new Promise((r) => setTimeout(r, 10));
    await manager.create({ title: "Third" });

    const desc = await manager.list({ sortBy: "created_at", sortDirection: "desc" });
    assertExists(desc.issues[0]);
    assertExists(desc.issues[2]);
    assertEquals(desc.issues[0].metadata.title, "Third");
    assertEquals(desc.issues[2].metadata.title, "First");

    const asc = await manager.list({ sortBy: "created_at", sortDirection: "asc" });
    assertExists(asc.issues[0]);
    assertExists(asc.issues[2]);
    assertEquals(asc.issues[0].metadata.title, "First");
    assertEquals(asc.issues[2].metadata.title, "Third");
  });
});

Deno.test("IssuesManager.list - respects limit", async () => {
  await withTempDir(async (dir) => {
    const manager = createIssuesManager(dir);
    for (let i = 0; i < 10; i++) {
      await manager.create({ title: `Issue ${i}` });
    }

    const result = await manager.list({ limit: 5 });
    assertEquals(result.total, 10);
    assertEquals(result.issues.length, 5);
  });
});

Deno.test("IssuesManager.close - closes an issue", async () => {
  await withTempDir(async (dir) => {
    const manager = createIssuesManager(dir);
    const created = await manager.create({ title: "Test" });

    const closed = await manager.close(created.metadata.id);
    assertExists(closed);
    assertEquals(closed.metadata.state, "closed");
  });
});

Deno.test("IssuesManager.reopen - reopens a closed issue", async () => {
  await withTempDir(async (dir) => {
    const manager = createIssuesManager(dir);
    const created = await manager.create({ title: "Test" });
    await manager.close(created.metadata.id);

    const reopened = await manager.reopen(created.metadata.id);
    assertExists(reopened);
    assertEquals(reopened.metadata.state, "open");
  });
});

Deno.test("IssuesManager.addLabels - adds labels to issue", async () => {
  await withTempDir(async (dir) => {
    const manager = createIssuesManager(dir);
    const created = await manager.create({ title: "Test", labels: ["bug"] });

    const updated = await manager.addLabels(created.metadata.id, ["priority:high"]);
    assertExists(updated);
    assertEquals(updated.metadata.labels, ["bug", "priority:high"]);
  });
});

Deno.test("IssuesManager.addLabels - deduplicates labels", async () => {
  await withTempDir(async (dir) => {
    const manager = createIssuesManager(dir);
    const created = await manager.create({ title: "Test", labels: ["bug"] });

    const updated = await manager.addLabels(created.metadata.id, ["bug", "feature"]);
    assertExists(updated);
    assertEquals(updated.metadata.labels, ["bug", "feature"]);
  });
});

Deno.test("IssuesManager.removeLabels - removes labels from issue", async () => {
  await withTempDir(async (dir) => {
    const manager = createIssuesManager(dir);
    const created = await manager.create({
      title: "Test",
      labels: ["bug", "feature", "wontfix"],
    });

    const updated = await manager.removeLabels(created.metadata.id, ["wontfix"]);
    assertExists(updated);
    assertEquals(updated.metadata.labels, ["bug", "feature"]);
  });
});

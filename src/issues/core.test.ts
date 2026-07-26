import "#veryfront/schemas/_test-setup.ts";
/**
 * Tests for the issues core module
 *
 * @module issues/core.test
 */

import {
  assertEquals,
  assertExists,
  assertRejects,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { join } from "#veryfront/compat/path";
import { createFileSystem, type FileSystem } from "#veryfront/platform/compat/fs.ts";
import {
  createIssuesManager,
  MAX_ISSUE_FILE_BYTES,
  MAX_ISSUE_FRONTMATTER_LENGTH,
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

Deno.test("parseYaml - keeps special keys as inert own data", () => {
  const result = parseYaml("__proto__: inert\nconstructor: value");
  assertEquals(Object.getPrototypeOf(result), null);
  assertEquals(Object.prototype.hasOwnProperty.call(result, "__proto__"), true);
  assertEquals(result.__proto__, "inert");
  assertEquals(result.constructor, "value");
  assertEquals(({} as Record<string, unknown>).inert, undefined);
});

Deno.test("parseYaml - rejects duplicate or unsupported structures", () => {
  assertThrows(() => parseYaml("title: one\ntitle: two"));
  assertThrows(() => parseYaml("  nested: value"));
  assertThrows(() => parseYaml("- orphan"));
  assertThrows(() => parseYaml('labels: ["unterminated]'));
  assertThrows(() => parseYaml("title: 'broken'quote'"));
});

Deno.test("parseYaml - rejects input beyond the frontmatter bound", () => {
  assertThrows(() => parseYaml(`title: ${"x".repeat(MAX_ISSUE_FRONTMATTER_LENGTH)}`));
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

Deno.test("parseFrontmatter - rejects oversized metadata before parsing", () => {
  const result = parseFrontmatter(
    `---\n${"x".repeat(MAX_ISSUE_FRONTMATTER_LENGTH + 1)}\n---\n\nbody\n`,
  );
  assertEquals(result, null);
});

Deno.test("parseFrontmatter - rejects oversized files before matching delimiters", () => {
  const prefix = "---\nid: ISSUE-001\n---\n\n";
  assertEquals(
    parseFrontmatter(
      `${prefix}${"x".repeat(MAX_ISSUE_FILE_BYTES - prefix.length + 1)}`,
    ) === null,
    true,
  );
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

Deno.test("serializeYaml - preserves empty arrays", () => {
  const metadata: IssueMetadata = {
    id: "ISSUE-001",
    title: "Test issue",
    state: "open",
    labels: [],
    assignees: [],
    created_at: "2026-01-23T00:00:00.000Z",
    updated_at: "2026-01-23T00:00:00.000Z",
  };

  const yaml = serializeYaml(metadata);
  assertEquals(yaml.includes("labels: []"), true);
  assertEquals(yaml.includes("assignees: []"), true);
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

function proxyFileSystem(
  base: FileSystem,
  overrides: Partial<FileSystem>,
): FileSystem {
  return new Proxy(base, {
    get(target, property, receiver) {
      const override = Reflect.get(overrides, property, overrides);
      if (override !== undefined) {
        return typeof override === "function" ? override.bind(overrides) : override;
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
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

Deno.test("IssuesManager.update - clears milestone when set to null", async () => {
  await withTempDir(async (dir) => {
    const manager = createIssuesManager(dir);
    const created = await manager.create({
      title: "Original",
      milestone: "v1",
    });

    const updated = await manager.update(created.metadata.id, {
      milestone: null,
    });

    assertExists(updated);
    assertEquals(updated.metadata.milestone, undefined);
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

Deno.test("IssuesManager.list - sorts by id", async () => {
  await withTempDir(async (dir) => {
    const manager = createIssuesManager(dir);
    await manager.create({ title: "Issue 1", prefix: "ISSUE" });
    await manager.create({ title: "Task 1", prefix: "TASK" });
    await manager.create({ title: "Issue 2", prefix: "ISSUE" });

    const asc = await manager.list({ prefix: "ISSUE", sortBy: "id", sortDirection: "asc" });
    assertExists(asc.issues[0]);
    assertExists(asc.issues[1]);
    assertEquals(asc.issues.map((issue) => issue.metadata.id), ["ISSUE-001", "ISSUE-002"]);

    const desc = await manager.list({ prefix: "ISSUE", sortBy: "id", sortDirection: "desc" });
    assertEquals(desc.issues.map((issue) => issue.metadata.id), ["ISSUE-002", "ISSUE-001"]);
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

    const updated = await manager.addLabels(created.metadata.id, [
      "bug",
      "feature",
      "feature",
    ]);
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

Deno.test("IssuesManager.listIds - ignores non-issue markdown files", async () => {
  await withTempDir(async (dir) => {
    const manager = createIssuesManager(dir);
    await manager.ensureDir();

    await Deno.writeTextFile(join(dir, "issues/ISSUE-002.md"), "");
    await Deno.writeTextFile(join(dir, "issues/not-an-issue.md"), "");
    await Deno.writeTextFile(join(dir, "issues/ISSUE-003.txt"), "");

    assertEquals(await manager.listIds(), ["ISSUE-002"]);
  });
});

Deno.test("serializeIssue - round-trips every schema-valid metadata string", () => {
  const issue: Issue = {
    metadata: {
      id: "ISSUE-001",
      title: 'Fix "quoted" paths like C:\\work',
      state: "open",
      labels: ["needs,review", 'quote"label', "priority:high"],
      milestone: "v1: # launch",
      assignees: ["alice,ops", 'o"connor'],
      created_at: "2026-01-23T00:00:00.000Z",
      updated_at: "2026-01-23T00:00:00.000Z",
    },
    body: "Metadata punctuation must not alter frontmatter.",
    path: "issues/ISSUE-001.md",
  };

  const parsed = parseIssue(serializeIssue(issue), issue.path);
  assertExists(parsed);
  assertEquals(parsed, issue);
});

Deno.test("IssuesManager rejects traversal-shaped IDs before filesystem access", async () => {
  await withTempDir(async (dir) => {
    const outside: Issue = {
      metadata: {
        id: "ISSUE-777",
        title: "Outside",
        state: "open",
        labels: [],
        assignees: [],
        created_at: "2026-01-23T00:00:00.000Z",
        updated_at: "2026-01-23T00:00:00.000Z",
      },
      body: "",
      path: "outside.md",
    };
    await Deno.writeTextFile(join(dir, "outside.md"), serializeIssue(outside));

    const manager = createIssuesManager(dir);
    await assertRejects(() => manager.get("../outside"));
    await assertRejects(() => manager.update("../outside", { title: "Changed" }));
    await assertRejects(() => manager.delete("../outside"));

    const unchanged = parseIssue(
      await Deno.readTextFile(join(dir, "outside.md")),
      "outside.md",
    );
    assertEquals(unchanged?.metadata.title, "Outside");
  });
});

Deno.test("IssuesManager rejects unsafe project-directory text", () => {
  for (
    const projectDir of [
      "",
      "   ",
      "bad\u0000path",
      "bad\u001bpath",
      "bad\uD800path",
      "x".repeat(4_097),
    ]
  ) {
    assertThrows(() => createIssuesManager(projectDir));
  }
});

Deno.test("IssuesManager surfaces storage failures instead of reporting absence", async () => {
  await withTempDir(async (dir) => {
    const manager = createIssuesManager(dir);
    const created = await manager.create({ title: "Present" });
    const denied = Object.assign(new Error("permission denied"), { code: "EACCES" });
    const base = createFileSystem();

    const readFailure = createIssuesManager(
      dir,
      proxyFileSystem(base, {
        readTextFile: () => Promise.reject(denied),
      }),
    );
    await assertRejects(() => readFailure.get(created.metadata.id), Error, "permission denied");

    const listFailure = createIssuesManager(
      dir,
      proxyFileSystem(base, {
        readDir: () => ({
          [Symbol.asyncIterator]() {
            return {
              next: () => Promise.reject(denied),
            };
          },
        }),
      }),
    );
    await assertRejects(() => listFailure.listIds(), Error, "permission denied");

    const deleteFailure = createIssuesManager(
      dir,
      proxyFileSystem(base, {
        remove: (path, options) =>
          path.endsWith(".md") ? Promise.reject(denied) : base.remove(path, options),
      }),
    );
    await assertRejects(
      () => deleteFailure.delete(created.metadata.id),
      Error,
      "permission denied",
    );
  });
});

Deno.test("IssuesManager surfaces corrupt issue files instead of hiding them", async () => {
  await withTempDir(async (dir) => {
    const manager = createIssuesManager(dir);
    await manager.ensureDir();
    await Deno.writeTextFile(
      join(dir, "issues", "ISSUE-001.md"),
      "---\nid: ISSUE-001\nstate: open\n---\n",
    );

    await assertRejects(() => manager.get("ISSUE-001"), Error, "ISSUE-001");
    await assertRejects(() => manager.list(), Error, "ISSUE-001");
  });
});

Deno.test("IssuesManager rejects symlinked issue files", async () => {
  await withTempDir(async (dir) => {
    const manager = createIssuesManager(dir);
    await manager.ensureDir();

    const outsidePath = join(dir, "outside.md");
    const outside: Issue = {
      metadata: {
        id: "ISSUE-001",
        title: "Outside",
        state: "open",
        labels: [],
        assignees: [],
        created_at: "2026-01-23T00:00:00.000Z",
        updated_at: "2026-01-23T00:00:00.000Z",
      },
      body: "",
      path: "outside.md",
    };
    await Deno.writeTextFile(outsidePath, serializeIssue(outside));
    await Deno.symlink(outsidePath, join(dir, "issues", "ISSUE-001.md"));

    await assertRejects(() => manager.get("ISSUE-001"));
    await assertRejects(() => manager.update("ISSUE-001", { title: "Changed" }));
    assertEquals(
      parseIssue(await Deno.readTextFile(outsidePath), "outside.md")?.metadata.title,
      "Outside",
    );
  });
});

Deno.test("IssuesManager rejects a symlinked issues storage directory", async () => {
  await withTempDir(async (dir) => {
    const externalDir = join(dir, "external-issues");
    await Deno.mkdir(externalDir);
    const externalIssue: Issue = {
      metadata: {
        id: "ISSUE-001",
        title: "External",
        state: "open",
        labels: [],
        assignees: [],
        created_at: "2026-01-23T00:00:00.000Z",
        updated_at: "2026-01-23T00:00:00.000Z",
      },
      body: "",
      path: "issues/ISSUE-001.md",
    };
    const externalPath = join(externalDir, "ISSUE-001.md");
    await Deno.writeTextFile(externalPath, serializeIssue(externalIssue));
    await Deno.symlink(externalDir, join(dir, "issues"), { type: "dir" });

    const manager = createIssuesManager(dir);
    await assertRejects(() => manager.listIds(), Error, "symbolic link");
    await assertRejects(() => manager.get("ISSUE-001"), Error, "symbolic link");
    await assertRejects(
      () => manager.update("ISSUE-001", { title: "Changed" }),
      Error,
      "symbolic link",
    );
    await assertRejects(() => manager.delete("ISSUE-001"), Error, "symbolic link");
    assertEquals((await Deno.stat(externalPath)).isFile, true);
  });
});

Deno.test("IssuesManager.create allocates distinct IDs across path aliases", async () => {
  await withTempDir(async (dir) => {
    const operationCount = 12;
    const alias = join(dir, "project-alias");
    await Deno.symlink(dir, alias, { type: "dir" });
    const managers = [
      createIssuesManager(dir),
      createIssuesManager(alias),
    ];

    const created = await Promise.all(
      Array.from(
        { length: operationCount },
        (_, index) =>
          managers[index % managers.length]!.create({
            title: `Concurrent ${index}`,
          }),
      ),
    );
    const ids = created.map((issue) => issue.metadata.id);
    assertEquals(new Set(ids).size, operationCount);
    assertEquals((await managers[0]!.list()).total, operationCount);
  });
});

Deno.test("IssuesManager.list sorts numeric issue suffixes deterministically", async () => {
  await withTempDir(async (dir) => {
    const manager = createIssuesManager(dir);
    await manager.ensureDir();

    for (const id of ["ISSUE-999", "ISSUE-1000"]) {
      const issue: Issue = {
        metadata: {
          id,
          title: id,
          state: "open",
          labels: [],
          assignees: [],
          created_at: "2026-01-23T00:00:00.000Z",
          updated_at: "2026-01-23T00:00:00.000Z",
        },
        body: "",
        path: `issues/${id}.md`,
      };
      await Deno.writeTextFile(join(dir, issue.path), serializeIssue(issue));
    }

    const result = await manager.list({ sortBy: "id", sortDirection: "asc" });
    assertEquals(result.issues.map((issue) => issue.metadata.id), [
      "ISSUE-999",
      "ISSUE-1000",
    ]);
  });
});

Deno.test("IssuesManager.list preserves sub-millisecond timestamp ordering", async () => {
  await withTempDir(async (dir) => {
    const manager = createIssuesManager(dir);
    await manager.ensureDir();

    for (
      const [id, timestamp] of [
        ["ISSUE-001", "2026-01-23T00:00:00.000000002Z"],
        ["ISSUE-002", "2026-01-23T00:00:00.000000001Z"],
      ] as const
    ) {
      const issue: Issue = {
        metadata: {
          id,
          title: id,
          state: "open",
          labels: [],
          assignees: [],
          created_at: timestamp,
          updated_at: timestamp,
        },
        body: "",
        path: `issues/${id}.md`,
      };
      await Deno.writeTextFile(join(dir, issue.path), serializeIssue(issue));
    }

    const result = await manager.list({
      sortBy: "created_at",
      sortDirection: "asc",
    });
    assertEquals(result.issues.map((issue) => issue.metadata.id), [
      "ISSUE-002",
      "ISSUE-001",
    ]);
  });
});

Deno.test("IssuesManager.update leaves no-op records unchanged", async () => {
  await withTempDir(async (dir) => {
    const manager = createIssuesManager(dir);
    const created = await manager.create({ title: "Stable", labels: ["bug"] });
    const before = await Deno.readTextFile(join(dir, created.path));

    const updated = await manager.update(created.metadata.id, {
      title: "Stable",
      labels: ["bug"],
    });

    assertEquals(updated, created);
    assertEquals(await Deno.readTextFile(join(dir, created.path)), before);
  });
});

Deno.test("IssuesManager rejects timestamp overflow without changing the issue", async () => {
  await withTempDir(async (dir) => {
    const manager = createIssuesManager(dir);
    await manager.ensureDir();
    const timestamp = "9999-12-31T23:59:59.999999999Z";
    const issue: Issue = {
      metadata: {
        id: "ISSUE-001",
        title: "Last timestamp",
        state: "open",
        labels: [],
        assignees: [],
        created_at: timestamp,
        updated_at: timestamp,
      },
      body: "",
      path: "issues/ISSUE-001.md",
    };
    await Deno.writeTextFile(join(dir, issue.path), serializeIssue(issue));

    const error = await assertRejects(
      () => manager.update(issue.metadata.id, { title: "Must not commit" }),
      Error,
      "cannot advance",
    );
    assertEquals(
      (error as Error & { slug?: string }).slug,
      "issue-storage-conflict",
    );
    assertEquals(await manager.get(issue.metadata.id), issue);
    assertEquals(
      await Deno.stat(join(dir, "issues", ".locks", issue.metadata.id)).then(
        () => true,
        () => false,
      ),
      false,
    );
  });
});

Deno.test("serializeIssue preserves intentional body whitespace across a round trip", () => {
  const issue: Issue = {
    metadata: {
      id: "ISSUE-001",
      title: "Whitespace",
      state: "open",
      labels: [],
      assignees: [],
      created_at: "2026-01-23T00:00:00.000Z",
      updated_at: "2026-01-23T00:00:00.000Z",
    },
    body: "  indented\n\ntrailing spaces  \n",
    path: "issues/ISSUE-001.md",
  };

  assertEquals(parseIssue(serializeIssue(issue), issue.path), issue);
});

Deno.test("parseFrontmatter accepts CRLF delimiters", () => {
  const parsed = parseFrontmatter(
    "---\r\nid: ISSUE-001\r\ntitle: Test\r\n---\r\n\r\nBody\r\n",
  );
  assertExists(parsed);
  assertEquals(parsed.frontmatter, "id: ISSUE-001\r\ntitle: Test");
  assertEquals(parsed.body, "Body");
});

Deno.test("IssuesManager never reuses a reserved or deleted issue ID", async () => {
  await withTempDir(async (dir) => {
    const manager = createIssuesManager(dir);
    const first = await manager.create({ title: "First" });
    assertEquals(first.metadata.id, "ISSUE-001");
    assertEquals(
      await Deno.readTextFile(
        join(dir, "issues", ".ids", first.metadata.id, "reservation"),
      ),
      `${first.metadata.id}\n`,
    );
    assertEquals(await manager.delete(first.metadata.id), true);

    const second = await manager.create({ title: "Second" });
    assertEquals(second.metadata.id, "ISSUE-002");
  });
});

Deno.test("IssuesManager sorts numerically equivalent IDs deterministically", async () => {
  await withTempDir(async (dir) => {
    await Deno.mkdir(join(dir, "issues"));
    const base = createFileSystem();
    const fs = proxyFileSystem(base, {
      readDir: () =>
        (async function* () {
          yield {
            name: "ISSUE-001.md",
            isFile: true,
            isDirectory: false,
            isSymlink: false,
          };
          yield {
            name: "ISSUE-0001.md",
            isFile: true,
            isDirectory: false,
            isSymlink: false,
          };
        })(),
    });

    assertEquals(
      await createIssuesManager(dir, fs).listIds(),
      ["ISSUE-0001", "ISSUE-001"],
    );
  });
});

Deno.test("IssuesManager releases a reservation after an ordinary write failure", async () => {
  await withTempDir(async (dir) => {
    const base = createFileSystem();
    let failNextIssueWrite = true;
    const fs = proxyFileSystem(base, {
      writeTextFile(path, data) {
        if (failNextIssueWrite && path.endsWith(".tmp")) {
          failNextIssueWrite = false;
          return Promise.reject(new Error("simulated write failure"));
        }
        return base.writeTextFile(path, data);
      },
    });
    const manager = createIssuesManager(dir, fs);

    await assertRejects(
      () => manager.create({ title: "Fails" }),
      Error,
      "simulated write failure",
    );
    const created = await manager.create({ title: "Retries" });
    assertEquals(created.metadata.id, "ISSUE-001");
  });
});

Deno.test("IssuesManager keeps the previous issue intact when atomic replacement fails", async () => {
  await withTempDir(async (dir) => {
    const base = createFileSystem();
    const manager = createIssuesManager(dir);
    const created = await manager.create({ title: "Original" });
    const fs = proxyFileSystem(base, {
      rename: () => Promise.reject(new Error("simulated rename failure")),
    });
    const failingManager = createIssuesManager(dir, fs);

    await assertRejects(
      () => failingManager.update(created.metadata.id, { title: "Replacement" }),
      Error,
      "simulated rename failure",
    );
    const persisted = await manager.get(created.metadata.id);
    assertEquals(persisted?.metadata.title, "Original");

    const entries = [];
    for await (const entry of Deno.readDir(join(dir, "issues"))) entries.push(entry.name);
    assertEquals(entries.some((name) => name.endsWith(".tmp")), false);
    assertEquals(
      await base.exists(join(dir, "issues", ".locks", created.metadata.id)),
      false,
    );
  });
});

Deno.test("IssuesManager serializes concurrent read-modify-write label changes", async () => {
  await withTempDir(async (dir) => {
    const manager = createIssuesManager(dir);
    const created = await manager.create({ title: "Concurrent labels" });

    await Promise.all([
      manager.addLabels(created.metadata.id, ["one"]),
      manager.addLabels(created.metadata.id, ["two"]),
    ]);

    const updated = await manager.get(created.metadata.id);
    assertEquals(updated?.metadata.labels, ["one", "two"]);
  });
});

Deno.test("IssuesManager coordinates mutations across project path aliases", async () => {
  await withTempDir(async (dir) => {
    const primary = createIssuesManager(dir);
    const created = await primary.create({ title: "Aliased mutations" });
    const alias = join(dir, "project-alias");
    await Deno.symlink(dir, alias, { type: "dir" });

    const base = createFileSystem();
    const delayedFs = proxyFileSystem(base, {
      async readTextFile(path) {
        const content = await base.readTextFile(path);
        if (path.endsWith(".md")) {
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        return content;
      },
    });
    const managers = [
      createIssuesManager(dir, delayedFs),
      createIssuesManager(alias, delayedFs),
    ];
    const mutations = [
      () => managers[0]!.addLabels(created.metadata.id, ["one"]),
      () => managers[1]!.addLabels(created.metadata.id, ["two"]),
    ];

    const settled = await Promise.allSettled(mutations.map((mutation) => mutation()));
    assertEquals(
      settled.filter((result) => result.status === "fulfilled").length,
      1,
    );
    assertEquals(
      settled.filter((result) => result.status === "rejected").length,
      1,
    );

    const rejectedIndex = settled.findIndex((result) => result.status === "rejected");
    await mutations[rejectedIndex]!();
    const updated = await primary.get(created.metadata.id);
    assertExists(updated);
    assertEquals(new Set(updated.metadata.labels), new Set(["one", "two"]));
  });
});

Deno.test("IssuesManager fails closed on a pre-existing mutation lock", async () => {
  await withTempDir(async (dir) => {
    const manager = createIssuesManager(dir);
    const created = await manager.create({ title: "Locked" });
    const lockPath = join(dir, "issues", ".locks", created.metadata.id);
    await Deno.mkdir(lockPath, { recursive: true });

    const error = await assertRejects(
      () => manager.update(created.metadata.id, { title: "Must not write" }),
      Error,
      "already being modified",
    );
    assertEquals(
      (error as Error & { slug?: string }).slug,
      "issue-storage-conflict",
    );
    assertEquals(
      (await manager.get(created.metadata.id))?.metadata.title,
      "Locked",
    );

    await Deno.remove(lockPath, { recursive: true });
    assertEquals(
      (await manager.update(created.metadata.id, { title: "Retry" }))?.metadata.title,
      "Retry",
    );
  });
});

Deno.test("IssuesManager reports a committed mutation when lock cleanup fails", async () => {
  await withTempDir(async (dir) => {
    const base = createFileSystem();
    const manager = createIssuesManager(dir);
    const created = await manager.create({ title: "Before cleanup failure" });
    const cleanupError = new Error("simulated lock cleanup failure");
    const lockPath = join(dir, "issues", ".locks", created.metadata.id);
    const fs = proxyFileSystem(base, {
      remove(path, options) {
        if (path === lockPath) return Promise.reject(cleanupError);
        return base.remove(path, options);
      },
    });

    const error = await assertRejects(
      () =>
        createIssuesManager(dir, fs).update(created.metadata.id, {
          title: "Committed before cleanup failure",
        }),
      Error,
      cleanupError.message,
    );
    assertEquals(error, cleanupError);
    assertEquals(
      (await manager.get(created.metadata.id))?.metadata.title,
      "Committed before cleanup failure",
    );
    assertEquals(await base.exists(lockPath), true);
  });
});

Deno.test("IssuesManager preserves operation and lock cleanup failures", async () => {
  await withTempDir(async (dir) => {
    const base = createFileSystem();
    const manager = createIssuesManager(dir);
    const created = await manager.create({ title: "Operation failure" });
    const operationError = new Error("simulated issue read failure");
    const cleanupError = new Error("simulated lock cleanup failure");
    const lockPath = join(dir, "issues", ".locks", created.metadata.id);
    const fs = proxyFileSystem(base, {
      readTextFile(path) {
        if (path.endsWith(`${created.metadata.id}.md`)) {
          return Promise.reject(operationError);
        }
        return base.readTextFile(path);
      },
      remove(path, options) {
        if (path === lockPath) return Promise.reject(cleanupError);
        return base.remove(path, options);
      },
    });

    const error = await assertRejects(
      () =>
        createIssuesManager(dir, fs).update(created.metadata.id, {
          title: "Must not commit",
        }),
      AggregateError,
      "mutation failed and lock cleanup also failed",
    );
    assertEquals(error.errors, [operationError, cleanupError]);
    assertEquals((await manager.get(created.metadata.id))?.metadata.title, "Operation failure");
    assertEquals(await base.exists(lockPath), true);
  });
});

Deno.test("IssuesManager rejects oversized files before reading their contents", async () => {
  await withTempDir(async (dir) => {
    const manager = createIssuesManager(dir);
    const created = await manager.create({ title: "Bounded" });
    const base = createFileSystem();
    let readCalled = false;
    const fs = proxyFileSystem(base, {
      async lstat(path) {
        const info = await base.lstat!(path);
        return { ...info, size: MAX_ISSUE_FILE_BYTES + 1 };
      },
      readTextFile() {
        readCalled = true;
        return Promise.reject(new Error("must not read oversized file"));
      },
    });

    await assertRejects(
      () => createIssuesManager(dir, fs).get(created.metadata.id),
      Error,
      "file-size limit",
    );
    assertEquals(readCalled, false);
  });
});

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
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createIssuesManager,
  parseFrontmatter,
  parseIssue,
  parseYaml,
  serializeIssue,
  serializeYaml,
} from "./core.ts";
import { type Issue, ISSUE_STORAGE_LIMITS, type IssueMetadata } from "./schemas/index.ts";

function overrideFileSystem(overrides: Partial<FileSystem>): FileSystem {
  const base = createFileSystem();
  return new Proxy(base, {
    get(target, property) {
      if (Object.hasOwn(overrides, property)) {
        return Reflect.get(overrides, property, overrides);
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

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
  assertEquals(result.body, "This is the body.\n");
});

Deno.test("parseFrontmatter - returns null for invalid content", () => {
  const result = parseFrontmatter("No frontmatter here");
  assertEquals(result, null);
});

Deno.test("parseFrontmatter - accepts BOM and CRLF without trimming body content", () => {
  const result = parseFrontmatter("\ufeff---\r\nid: ISSUE-001\r\n---\r\n\r\n  body  \r\n");

  assertExists(result);
  assertEquals(result.frontmatter, "id: ISSUE-001");
  assertEquals(result.body, "  body  \r\n");
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

Deno.test("serializeIssue - round-trips quoted and comma-containing metadata", () => {
  const issue: Issue = {
    metadata: {
      id: "ISSUE-001",
      title: 'Fix "quoted" \\ path',
      state: "open",
      labels: ["comma,label", 'quote"label', "slash\\label"],
      milestone: 'release: "one"',
      assignees: ["alice,smith"],
      created_at: "2026-01-23T00:00:00.000Z",
      updated_at: "2026-01-23T00:00:00.000Z",
    },
    body: "  Preserve markdown whitespace.  \n\n",
    path: "issues/ISSUE-001.md",
  };

  assertEquals(parseIssue(serializeIssue(issue), issue.path), issue);
});

Deno.test("serializeIssue - rejects documents beyond the storage byte limit", () => {
  const issue: Issue = {
    metadata: {
      id: "ISSUE-001",
      title: "Oversized",
      state: "open",
      labels: [],
      assignees: [],
      created_at: "2026-01-23T00:00:00.000Z",
      updated_at: "2026-01-23T00:00:00.000Z",
    },
    body: "😀".repeat(300_000),
    path: "issues/ISSUE-001.md",
  };

  assertThrows(() => serializeIssue(issue), Error);
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

Deno.test("IssuesManager.create - reserves unique IDs across concurrent creates", async () => {
  await withTempDir(async (dir) => {
    const base = createFileSystem();
    let waitingWrites = 0;
    let releaseWrites!: () => void;
    const writesReady = new Promise<void>((resolve) => {
      releaseWrites = resolve;
    });
    const delayedFs = overrideFileSystem({
      async writeTextFile(path, data) {
        waitingWrites++;
        if (waitingWrites === 2) releaseWrites();
        await writesReady;
        await base.writeTextFile(path, data);
      },
    });
    const manager = createIssuesManager(dir, delayedFs);

    const created = await Promise.all([
      manager.create({ title: "First" }),
      manager.create({ title: "Second" }),
    ]);

    assertEquals(new Set(created.map((issue) => issue.metadata.id)).size, 2);
    assertEquals((await manager.listIds()).sort(), ["ISSUE-001", "ISSUE-002"]);
  });
});

Deno.test("IssuesManager.create - rejects issue storage symlinks before creating reservations", async () => {
  await withTempDir(async (dir) => {
    const projectDir = join(dir, "project");
    const outsideDir = join(dir, "outside");
    await Deno.mkdir(projectDir);
    await Deno.mkdir(outsideDir);
    await Deno.symlink(outsideDir, join(projectDir, "issues"));

    const manager = createIssuesManager(projectDir);
    await assertRejects(
      () => manager.create({ title: "Must not escape" }),
      Error,
      "must stay within the project directory",
    );
    await assertRejects(() => Deno.stat(join(outsideDir, ".ids")), Deno.errors.NotFound);
  });
});

Deno.test("IssuesManager.create - rejects reservation directory symlinks", async () => {
  await withTempDir(async (dir) => {
    const outsideDir = join(dir, "outside");
    await Deno.mkdir(join(dir, "issues"));
    await Deno.mkdir(outsideDir);
    await Deno.symlink(outsideDir, join(dir, "issues", ".ids"));

    const manager = createIssuesManager(dir);
    await assertRejects(
      () => manager.create({ title: "Must not escape" }),
      Error,
      "must stay within the issue storage directory",
    );
    assertEquals((await Array.fromAsync(Deno.readDir(outsideDir))).length, 0);
  });
});

Deno.test("IssuesManager.ensureDir - accepts descendant names that begin with two dots", async () => {
  const manager = createIssuesManager(
    "/project",
    overrideFileSystem({
      mkdir: () => Promise.resolve(),
      realPath: (path) => {
        if (path === "/project") return Promise.resolve("/canonical");
        if (path === "/project/issues") return Promise.resolve("/canonical/..safe");
        return Promise.resolve("/canonical/..safe/.ids");
      },
    }),
  );

  await manager.ensureDir();
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

Deno.test("IssuesManager.get and delete - reject IDs that escape the issues directory", async () => {
  await withTempDir(async (dir) => {
    const manager = createIssuesManager(dir);
    const outsidePath = join(dir, "ISSUE-001.md");
    await Deno.writeTextFile(
      outsidePath,
      serializeIssue({
        metadata: {
          id: "ISSUE-001",
          title: "Outside",
          state: "open",
          labels: [],
          assignees: [],
          created_at: "2026-01-23T00:00:00.000Z",
          updated_at: "2026-01-23T00:00:00.000Z",
        },
        body: "Must remain untouched.",
        path: "issues/ISSUE-001.md",
      }),
    );

    await assertRejects(() => manager.get("../ISSUE-001"), Error);
    await assertRejects(() => manager.delete("../ISSUE-001"), Error);
    assertEquals((await Deno.stat(outsidePath)).isFile, true);
  });
});

Deno.test("IssuesManager.get - propagates operational read failures", async () => {
  const failure = new Error("permission denied");
  const manager = createIssuesManager(
    "/project",
    overrideFileSystem({
      realPath: (path) => Promise.resolve(path),
      lstat: () =>
        Promise.resolve({
          size: 1,
          isFile: true,
          isDirectory: false,
          isSymlink: false,
          mtime: null,
        }),
      readTextFile: () => Promise.reject(failure),
    }),
  );

  await assertRejects(() => manager.get("ISSUE-001"), Error, "permission denied");
});

Deno.test("IssuesManager.get - rejects corrupt and oversized issue files", async () => {
  await withTempDir(async (dir) => {
    const manager = createIssuesManager(dir);
    await manager.ensureDir();
    const path = join(dir, "issues", "ISSUE-001.md");

    await Deno.writeTextFile(path, "---\nid: ISSUE-001\n---\ninvalid");
    await assertRejects(() => manager.get("ISSUE-001"), Error, "Issue file is invalid");

    await Deno.writeTextFile(path, "x".repeat(1_048_577));
    await assertRejects(() => manager.get("ISSUE-001"), RangeError, "size limit");
  });
});

Deno.test("IssuesManager.get - rejects metadata IDs that differ from the file ID", async () => {
  await withTempDir(async (dir) => {
    const manager = createIssuesManager(dir);
    await manager.ensureDir();
    const mismatched = serializeIssue({
      metadata: {
        id: "ISSUE-002",
        title: "Mismatched",
        state: "open",
        labels: [],
        assignees: [],
        created_at: "2026-01-23T00:00:00.000Z",
        updated_at: "2026-01-23T00:00:00.000Z",
      },
      body: "",
      path: "issues/ISSUE-002.md",
    });
    await Deno.writeTextFile(join(dir, "issues", "ISSUE-001.md"), mismatched);

    await assertRejects(() => manager.get("ISSUE-001"), Error, "Issue file is invalid");
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
    assertEquals(updated.metadata.updated_at > created.metadata.updated_at, true);
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

Deno.test("IssuesManager.update - keeps the previous file when atomic replacement fails", async () => {
  await withTempDir(async (dir) => {
    const baseManager = createIssuesManager(dir);
    const created = await baseManager.create({ title: "Original", body: "Stable" });
    const manager = createIssuesManager(
      dir,
      overrideFileSystem({
        rename: () => Promise.reject(new Error("rename failed")),
      }),
    );

    await assertRejects(
      () => manager.update(created.metadata.id, { title: "Replacement" }),
      Error,
      "rename failed",
    );
    assertEquals((await baseManager.get(created.metadata.id))?.metadata.title, "Original");
  });
});

Deno.test("IssuesManager.update - serializes concurrent mutations for one issue", async () => {
  await withTempDir(async (dir) => {
    const baseManager = createIssuesManager(dir);
    const created = await baseManager.create({ title: "Original" });
    const base = createFileSystem();
    let readCount = 0;
    let releaseFirstRead!: () => void;
    let markFirstReadStarted!: () => void;
    let markSecondReadStarted!: () => void;
    const firstReadStarted = new Promise<void>((resolve) => {
      markFirstReadStarted = resolve;
    });
    const secondReadStarted = new Promise<void>((resolve) => {
      markSecondReadStarted = resolve;
    });
    const firstReadRelease = new Promise<void>((resolve) => {
      releaseFirstRead = resolve;
    });
    const manager = createIssuesManager(
      dir,
      overrideFileSystem({
        async readTextFile(path) {
          const content = await base.readTextFile(path);
          readCount++;
          if (readCount === 1) {
            markFirstReadStarted();
            await firstReadRelease;
          } else if (readCount === 2) {
            markSecondReadStarted();
          }
          return content;
        },
      }),
    );

    const rename = manager.update(created.metadata.id, { title: "Renamed" });
    await firstReadStarted;
    const relabel = manager.update(created.metadata.id, { labels: ["concurrent"] });
    await Promise.race([
      secondReadStarted,
      new Promise<void>((resolve) => setTimeout(resolve, 10)),
    ]);
    releaseFirstRead();
    await Promise.all([rename, relabel]);

    const result = await baseManager.get(created.metadata.id);
    assertExists(result);
    assertEquals(result.metadata.title, "Renamed");
    assertEquals(result.metadata.labels, ["concurrent"]);
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

Deno.test("IssuesManager.delete - propagates operational remove failures", async () => {
  const manager = createIssuesManager(
    "/project",
    overrideFileSystem({
      realPath: (path) => Promise.resolve(path),
      lstat: () =>
        Promise.resolve({
          size: 1,
          isFile: true,
          isDirectory: false,
          isSymlink: false,
          mtime: null,
        }),
      remove: () => Promise.reject(new Error("read-only filesystem")),
    }),
  );

  await assertRejects(
    () => manager.delete("ISSUE-001"),
    Error,
    "read-only filesystem",
  );
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
    await manager.ensureDir();
    for (
      const [id, title, createdAt] of [
        ["ISSUE-001", "First", "2026-01-23T00:00:00.000Z"],
        ["ISSUE-002", "Second", "2026-01-23T00:00:01.000Z"],
        ["ISSUE-003", "Third", "2026-01-23T00:00:02.000Z"],
      ] as const
    ) {
      await Deno.writeTextFile(
        join(dir, "issues", `${id}.md`),
        serializeIssue({
          metadata: {
            id,
            title,
            state: "open",
            labels: [],
            assignees: [],
            created_at: createdAt,
            updated_at: createdAt,
          },
          body: "",
          path: `issues/${id}.md`,
        }),
      );
    }

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

Deno.test("IssuesManager.list - sorts issue IDs by their numeric component", async () => {
  await withTempDir(async (dir) => {
    const manager = createIssuesManager(dir);
    await manager.ensureDir();
    for (const id of ["ISSUE-1000", "ISSUE-999"] as const) {
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
    assertEquals(result.issues.map((issue) => issue.metadata.id), ["ISSUE-999", "ISSUE-1000"]);
  });
});

Deno.test("IssuesManager.list - breaks timestamp ties by numeric issue ID", async () => {
  await withTempDir(async (dir) => {
    const manager = createIssuesManager(dir);
    await manager.ensureDir();
    for (const id of ["ISSUE-001", "ISSUE-002"] as const) {
      await Deno.writeTextFile(
        join(dir, "issues", `${id}.md`),
        serializeIssue({
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
        }),
      );
    }

    const result = await manager.list({ sortBy: "created_at", sortDirection: "desc" });
    assertEquals(result.issues.map((issue) => issue.metadata.id), ["ISSUE-002", "ISSUE-001"]);
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
    assertEquals(
      result.issues.map((issue) => issue.metadata.id),
      ["ISSUE-010", "ISSUE-009", "ISSUE-008", "ISSUE-007", "ISSUE-006"],
    );

    const ascending = await manager.list({ sortBy: "id", sortDirection: "asc", limit: 2 });
    assertEquals(ascending.issues.map((issue) => issue.metadata.id), ["ISSUE-001", "ISSUE-002"]);
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

Deno.test("IssuesManager.removeLabels - rejects unbounded label collections", async () => {
  await withTempDir(async (dir) => {
    const manager = createIssuesManager(dir);
    const created = await manager.create({ title: "Test", labels: ["bug"] });

    await assertRejects(
      () => manager.removeLabels(created.metadata.id, Array(101).fill("label")),
      Error,
    );
  });
});

Deno.test("IssuesManager - rejects unbounded project paths", () => {
  assertThrows(() => createIssuesManager("x".repeat(4_097)), TypeError, "Project directory");
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

Deno.test("IssuesManager.listIds - propagates directory errors and enforces a scan limit", async () => {
  const failingManager = createIssuesManager(
    "/project",
    overrideFileSystem({
      realPath: (path) => Promise.resolve(path),
      readDir: () => ({
        [Symbol.asyncIterator]() {
          return { next: () => Promise.reject(new Error("directory unavailable")) };
        },
      }),
    }),
  );
  await assertRejects(() => failingManager.listIds(), Error, "directory unavailable");

  const unboundedManager = createIssuesManager(
    "/project",
    overrideFileSystem({
      realPath: (path) => Promise.resolve(path),
      readDir: () =>
        (async function* () {
          for (let index = 1; index <= 10_001; index++) {
            yield {
              name: `ISSUE-${String(index).padStart(3, "0")}.md`,
              isFile: true,
              isDirectory: false,
              isSymlink: false,
            };
          }
        })(),
    }),
  );
  await assertRejects(() => unboundedManager.listIds(), RangeError, "scan limit");
});

describe("IssuesManager production invariants", () => {
  it("releases an ID reservation when create persistence fails", async () => {
    await withTempDir(async (dir) => {
      const base = createFileSystem();
      let failNextWrite = true;
      const manager = createIssuesManager(
        dir,
        overrideFileSystem({
          writeTextFile(path, data) {
            if (failNextWrite) {
              failNextWrite = false;
              return Promise.reject(new Error("write failed"));
            }
            return base.writeTextFile(path, data);
          },
        }),
      );

      await assertRejects(() => manager.create({ title: "Failed" }), Error, "write failed");
      const created = await manager.create({ title: "Recovered" });

      assertEquals(created.metadata.id, "ISSUE-001");
    });
  });

  it("preserves a committed create when rename reports an ambiguous failure", async () => {
    await withTempDir(async (dir) => {
      const base = createFileSystem();
      const manager = createIssuesManager(
        dir,
        overrideFileSystem({
          async rename(oldPath, newPath) {
            await base.rename!(oldPath, newPath);
            throw new Error("rename outcome unavailable");
          },
        }),
      );

      const first = await manager.create({ title: "Committed" });
      assertEquals(first.metadata.id, "ISSUE-001");
      assertEquals((await manager.get(first.metadata.id))?.metadata.title, "Committed");

      await manager.delete(first.metadata.id);
      const second = await manager.create({ title: "Next" });
      assertEquals(second.metadata.id, "ISSUE-002");
    });
  });

  it("does not rewrite files for idempotent no-op mutations", async () => {
    await withTempDir(async (dir) => {
      const baseManager = createIssuesManager(dir);
      const created = await baseManager.create({ title: "Stable", labels: ["bug"] });
      const base = createFileSystem();
      let renameCount = 0;
      const manager = createIssuesManager(
        dir,
        overrideFileSystem({
          async rename(oldPath, newPath) {
            renameCount++;
            await base.rename!(oldPath, newPath);
          },
        }),
      );

      await manager.update(created.metadata.id, { title: "Stable" });
      await manager.update(created.metadata.id, {});
      await manager.addLabels(created.metadata.id, ["bug"]);
      await manager.removeLabels(created.metadata.id, ["missing"]);
      const closed = await manager.close(created.metadata.id);
      const repeatedClose = await manager.close(created.metadata.id);

      assertEquals(renameCount, 1);
      assertEquals(repeatedClose?.metadata.updated_at, closed?.metadata.updated_at);
    });
  });

  it("bounds queued mutations for one issue", async () => {
    await withTempDir(async (dir) => {
      const baseManager = createIssuesManager(dir);
      const created = await baseManager.create({ title: "Queued" });
      const base = createFileSystem();
      let releaseRead!: () => void;
      let markReadStarted!: () => void;
      const readStarted = new Promise<void>((resolve) => {
        markReadStarted = resolve;
      });
      const readRelease = new Promise<void>((resolve) => {
        releaseRead = resolve;
      });
      let blockFirstRead = true;
      const manager = createIssuesManager(
        dir,
        overrideFileSystem({
          async readTextFile(path) {
            const content = await base.readTextFile(path);
            if (blockFirstRead) {
              blockFirstRead = false;
              markReadStarted();
              await readRelease;
            }
            return content;
          },
        }),
      );

      const updates = [manager.update(created.metadata.id, { title: "Queued 0" })];
      await readStarted;
      for (let index = 1; index <= ISSUE_STORAGE_LIMITS.maxPendingMutationsPerIssue; index++) {
        updates.push(manager.update(created.metadata.id, { title: `Queued ${index}` }));
      }

      let timeout: number | undefined;
      const capacityError = await Promise.race([
        Promise.any(
          updates.map((update) =>
            update.then(
              () => Promise.reject(new Error("Mutation completed before the queue filled")),
              (error) => error instanceof RangeError ? error : Promise.reject(error),
            )
          ),
        ),
        new Promise<null>((resolve) => {
          timeout = setTimeout(() => resolve(null), 50);
        }),
      ]);
      if (timeout !== undefined) clearTimeout(timeout);
      releaseRead();
      await Promise.allSettled(updates);

      assertEquals(capacityError instanceof RangeError, true);
    });
  });

  it("bounds retained list data while honoring explicit limits", async () => {
    const body = "x".repeat(ISSUE_STORAGE_LIMITS.maxBodyCharacters);
    const issueCount = Math.ceil(ISSUE_STORAGE_LIMITS.maxListResultBytes / body.length) + 1;
    const largeIssueFs = overrideFileSystem({
      realPath: (path) => Promise.resolve(path),
      lstat: () =>
        Promise.resolve({
          size: body.length + 512,
          isFile: true,
          isDirectory: false,
          isSymlink: false,
          mtime: null,
        }),
      readDir: () =>
        (async function* () {
          for (let index = 1; index <= issueCount; index++) {
            yield {
              name: `ISSUE-${String(index).padStart(3, "0")}.md`,
              isFile: true,
              isDirectory: false,
              isSymlink: false,
            };
          }
        })(),
      readTextFile: (path) => {
        const id = path.match(/(ISSUE-\d+)\.md$/)?.[1];
        assertExists(id);
        return Promise.resolve(serializeIssue({
          metadata: {
            id,
            title: id,
            state: "open",
            labels: [],
            assignees: [],
            created_at: "2026-01-23T00:00:00.000Z",
            updated_at: "2026-01-23T00:00:00.000Z",
          },
          body,
          path: `issues/${id}.md`,
        }));
      },
    });

    await assertRejects(
      () => createIssuesManager("/project", largeIssueFs).list(),
      RangeError,
      "list result",
    );
    assertEquals(
      (await createIssuesManager("/project", largeIssueFs).list({ limit: 1 })).issues.length,
      1,
    );
  });
});

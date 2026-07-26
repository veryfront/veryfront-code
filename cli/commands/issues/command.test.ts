import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { createIssuesManager, MAX_ISSUE_LIST_LIMIT } from "#veryfront/issues/index.ts";
import type { Issue } from "#veryfront/issues/index.ts";
import { issuesCommand } from "./command.ts";

async function withTempCwd(operation: (directory: string) => Promise<void>): Promise<void> {
  const previous = Deno.cwd();
  const directory = await Deno.makeTempDir({ prefix: "issues-command-test-" });
  try {
    Deno.chdir(directory);
    await operation(directory);
  } finally {
    Deno.chdir(previous);
    await Deno.remove(directory, { recursive: true });
  }
}

Deno.test("issuesCommand rejects unknown states and prefixes", async () => {
  const stateError = await assertRejects(() =>
    issuesCommand({
      _: ["issues", "list"],
      state: "pending",
    })
  );
  const prefixError = await assertRejects(() =>
    issuesCommand({
      _: ["issues", "create"],
      title: "Invalid prefix",
      prefix: "BUG",
    })
  );
  assertEquals((stateError as Error & { slug?: string }).slug, "invalid-argument");
  assertEquals((prefixError as Error & { slug?: string }).slug, "invalid-argument");
});

Deno.test("issuesCommand rejects invalid list controls at the CLI boundary", async () => {
  const invalidArguments = [
    { sort: "title" },
    { dir: "sideways" },
    { limit: "not-a-number" },
    { limit: 1.5 },
    { limit: 0 },
    { limit: MAX_ISSUE_LIST_LIMIT + 1 },
  ];

  for (const invalid of invalidArguments) {
    const error = await assertRejects(() =>
      issuesCommand({
        _: ["issues", "list"],
        ...invalid,
      })
    );
    assertEquals(
      (error as Error & { slug?: string }).slug,
      "invalid-argument",
    );
  }
});

Deno.test("issuesCommand creates and bounds JSON lists through real argument parsing", async () => {
  await withTempCwd(async () => {
    const output: string[] = [];
    const originalLog = console.log;
    console.log = (value?: unknown) => output.push(String(value));
    try {
      await issuesCommand({
        _: ["issues", "create"],
        title: "First",
        prefix: " task ",
        json: true,
      });
      await issuesCommand({
        _: ["issues", "create"],
        title: "Second",
        prefix: "TASK",
        json: true,
      });
      await issuesCommand({
        _: ["issues", "list"],
        prefix: "task",
        sort: "id",
        dir: "asc",
        limit: "1",
        json: true,
      });
    } finally {
      console.log = originalLog;
    }

    const first = JSON.parse(output[0]!) as Issue;
    const second = JSON.parse(output[1]!) as Issue;
    const result = JSON.parse(output[2]!) as {
      issues: Issue[];
      total: number;
    };
    assertEquals(first.metadata.id, "TASK-001");
    assertEquals(second.metadata.id, "TASK-002");
    assertEquals(result.total, 2);
    assertEquals(result.issues.map((issue) => issue.metadata.id), ["TASK-001"]);
  });
});

Deno.test("issuesCommand reports structured usage and missing-resource errors", async () => {
  await withTempCwd(async () => {
    const usageCases = [
      { _: ["issues", "create"] },
      { _: ["issues", "view"] },
      { _: ["issues", "edit", "ISSUE-001"] },
      { _: ["issues", "close"] },
      { _: ["issues", "reopen"] },
      { _: ["issues", "delete"] },
    ];
    for (const args of usageCases) {
      const error = await assertRejects(() => issuesCommand(args));
      assertEquals((error as Error & { slug?: string }).slug, "invalid-argument");
    }

    for (const command of ["view", "close", "reopen", "delete"]) {
      const error = await assertRejects(() =>
        issuesCommand({
          _: ["issues", command, "ISSUE-999"],
        })
      );
      assertEquals((error as Error & { slug?: string }).slug, "resource-not-found");
    }
  });
});

Deno.test("issuesCommand closes and reopens issues in JSON mode", async () => {
  await withTempCwd(async (directory) => {
    const manager = createIssuesManager(directory);
    const created = await manager.create({ title: "Lifecycle" });
    const output: string[] = [];
    const originalLog = console.log;
    console.log = (value?: unknown) => output.push(String(value));
    try {
      await issuesCommand({
        _: ["issues", "close", created.metadata.id],
        json: true,
      });
      await issuesCommand({
        _: ["issues", "reopen", created.metadata.id],
        json: true,
      });
    } finally {
      console.log = originalLog;
    }

    assertEquals((JSON.parse(output[0]!) as Issue).metadata.state, "closed");
    assertEquals((JSON.parse(output[1]!) as Issue).metadata.state, "open");
    assertEquals((await manager.get(created.metadata.id))?.metadata.state, "open");
  });
});

Deno.test("issuesCommand edit can explicitly clear optional fields", async () => {
  await withTempCwd(async (directory) => {
    const manager = createIssuesManager(directory);
    const created = await manager.create({
      title: "Clear fields",
      body: "body",
      labels: ["bug"],
      assignees: ["alice"],
      milestone: "v1",
    });
    const output: unknown[] = [];
    const originalLog = console.log;
    console.log = (value?: unknown) => output.push(value);
    try {
      await issuesCommand({
        _: ["issues", "edit", created.metadata.id],
        body: "",
        labels: "",
        assignees: "",
        milestone: "",
        json: true,
      });
    } finally {
      console.log = originalLog;
    }

    const updated = await manager.get(created.metadata.id);
    assertExists(updated);
    assertEquals(updated.body, "");
    assertEquals(updated.metadata.labels, []);
    assertEquals(updated.metadata.assignees, []);
    assertEquals(updated.metadata.milestone, undefined);
    assertEquals(output.length, 1);
  });
});

Deno.test("issuesCommand delete emits a JSON result in JSON mode", async () => {
  await withTempCwd(async (directory) => {
    const manager = createIssuesManager(directory);
    const created = await manager.create({ title: "Delete" });
    const output: string[] = [];
    const originalLog = console.log;
    console.log = (value?: unknown) => output.push(String(value));
    try {
      await issuesCommand({
        _: ["issues", "delete", created.metadata.id],
        json: true,
      });
    } finally {
      console.log = originalLog;
    }

    assertEquals(JSON.parse(output[0]!), {
      deleted: true,
      id: created.metadata.id,
    });
    assertEquals(await manager.get(created.metadata.id), null);
  });
});

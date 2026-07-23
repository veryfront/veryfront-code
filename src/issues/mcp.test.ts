import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createIssuesMcpTools, issuesMcpTools } from "./mcp.ts";

function getIssueTool(name: string, tools = issuesMcpTools) {
  const tool = tools.find((candidate) => candidate.name === name);
  assertExists(tool);
  return tool;
}

describe("issues/MCP", () => {
  it("publishes an immutable registry with sentence-case titles", () => {
    assertEquals(Object.isFrozen(issuesMcpTools), true);
    assertEquals(issuesMcpTools.every(Object.isFrozen), true);
    assertEquals(
      issuesMcpTools.every((tool) => !tool.annotations || Object.isFrozen(tool.annotations)),
      true,
    );
    assertEquals(issuesMcpTools.map((tool) => tool.title), [
      "Create issue",
      "Get issue",
      "Update issue",
      "List issues",
      "Close issue",
      "Delete issue",
    ]);
  });

  it("preserves the bounded create-issue contract", () => {
    const schema = getIssueTool("issues_create").inputSchema;

    assertEquals(schema.safeParse({ title: "Bounded" }).success, true);
    assertEquals(schema.safeParse({ title: "line one\nline two" }).success, false);
    assertEquals(
      schema.safeParse({ title: "Bounded", body: "x".repeat(1_000_001) }).success,
      false,
    );
    assertEquals(
      schema.safeParse({ title: "Bounded", labels: Array(101).fill("label") }).success,
      false,
    );
    assertEquals(schema.safeParse({ title: "Bounded", unexpected: true }).success, false);
  });

  it("accepts supported state aliases and rejects unknown state values", () => {
    const schema = getIssueTool("issues_update").inputSchema;

    assertEquals(schema.safeParse({ id: "ISSUE-001", state: "done" }).success, true);
    assertEquals(schema.safeParse({ id: "ISSUE-001", state: "completed" }).success, true);
    assertEquals(schema.safeParse({ id: "ISSUE-001", state: "unknown" }).success, false);
    assertEquals(schema.safeParse({ id: "ISSUE-001", state: "x".repeat(33) }).success, false);
  });

  it("preserves integer and resource bounds on list queries", () => {
    const schema = getIssueTool("issues_list").inputSchema;

    assertEquals(schema.safeParse({ limit: 1 }).success, true);
    for (const limit of [0, -1, 1.5, 1_001]) {
      assertEquals(schema.safeParse({ limit }).success, false);
    }
    assertEquals(schema.safeParse({ labels: Array(101).fill("label") }).success, false);
    assertEquals(schema.safeParse({ unknownFilter: true }).success, false);
  });

  it("rejects caller-supplied project directories", () => {
    const schema = getIssueTool("issues_get").inputSchema;

    assertEquals(schema.safeParse({ id: "ISSUE-001" }).success, true);
    assertEquals(
      schema.safeParse({ id: "ISSUE-001", projectDir: "another-project" }).success,
      false,
    );
  });

  it("binds each tool registry to its trusted project root", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "issues-mcp-test-" });
    try {
      const tools = createIssuesMcpTools(projectDir);
      const createTool = getIssueTool("issues_create", tools);
      const updateTool = getIssueTool("issues_update", tools);
      const created = await createTool.execute(
        createTool.inputSchema.parse({ title: "Alias" }),
      );
      const updated = await updateTool.execute(
        updateTool.inputSchema.parse({ id: created.metadata.id, state: "done" }),
      );

      assertExists(updated);
      assertEquals(updated.metadata.state, "closed");
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("executes the complete issue lifecycle through the bound tools", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "issues-mcp-lifecycle-" });
    try {
      const tools = createIssuesMcpTools(projectDir);
      const createTool = getIssueTool("issues_create", tools);
      const getTool = getIssueTool("issues_get", tools);
      const updateTool = getIssueTool("issues_update", tools);
      const listTool = getIssueTool("issues_list", tools);
      const closeTool = getIssueTool("issues_close", tools);
      const deleteTool = getIssueTool("issues_delete", tools);

      const created = await createTool.execute(createTool.inputSchema.parse({
        title: "Lifecycle",
        body: "Tracked through MCP.",
        labels: ["test"],
      }));
      assertEquals(
        (await getTool.execute(getTool.inputSchema.parse({ id: created.metadata.id })))?.body,
        "Tracked through MCP.",
      );

      const updated = await updateTool.execute(updateTool.inputSchema.parse({
        id: created.metadata.id,
        title: "Updated lifecycle",
        body: "Updated through MCP.",
        labels: ["updated"],
        milestone: "release",
        assignees: ["owner"],
      }));
      assertEquals(updated?.metadata.title, "Updated lifecycle");
      assertEquals(updated?.body, "Updated through MCP.");
      assertEquals(updated?.metadata.milestone, "release");
      assertEquals(updated?.metadata.assignees, ["owner"]);

      const listed = await listTool.execute(listTool.inputSchema.parse({ labels: ["updated"] }));
      assertEquals(listed.total, 1);
      assertEquals(listed.issues[0]?.metadata.id, created.metadata.id);

      const closed = await closeTool.execute(
        closeTool.inputSchema.parse({ id: created.metadata.id }),
      );
      assertEquals(closed?.metadata.state, "closed");

      assertEquals(
        await deleteTool.execute(deleteTool.inputSchema.parse({ id: created.metadata.id })),
        { deleted: true },
      );
      assertEquals(
        await deleteTool.execute(deleteTool.inputSchema.parse({ id: created.metadata.id })),
        { deleted: false },
      );
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("fails closed if execution bypasses input validation", async () => {
    const updateTool = getIssueTool("issues_update");

    await assertRejects(
      () =>
        updateTool.execute({
          id: "ISSUE-001",
          state: "unknown",
        }),
      TypeError,
      "Issue state must be open, closed, or a supported alias",
    );
  });
});

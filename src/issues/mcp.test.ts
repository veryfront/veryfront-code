import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { MCPTool } from "#veryfront/mcp/types.ts";
import { issuesMcpTools } from "./mcp.ts";

function requireTool(name: string): MCPTool {
  const tool = issuesMcpTools.find((candidate) => candidate.name === name);
  assertExists(tool);
  return tool;
}

describe("issues MCP tools", () => {
  it("publishes one uniquely named tool for every supported operation", () => {
    assertEquals(issuesMcpTools.map((tool) => tool.name), [
      "issues_create",
      "issues_get",
      "issues_update",
      "issues_list",
      "issues_close",
      "issues_delete",
    ]);
    assertEquals(new Set(issuesMcpTools.map((tool) => tool.name)).size, issuesMcpTools.length);
  });

  it("rejects invalid state aliases instead of silently performing a no-op", () => {
    const schema = requireTool("issues_update").inputSchema;
    assertThrows(() => schema.parse({ id: "ISSUE-001", state: "pending" }));
    assertEquals(schema.parse({ id: "ISSUE-001", state: "done" }).state, "done");
  });

  it("keeps list limits and project directories bounded at the MCP boundary", () => {
    const listSchema = requireTool("issues_list").inputSchema;
    assertEquals(listSchema.parse({ limit: 1_000 }).limit, 1_000);
    assertEquals(listSchema.parse({}).limit, 1_000);
    for (const limit of [0, 1.5, 1_001, Number.POSITIVE_INFINITY]) {
      assertThrows(() => listSchema.parse({ limit }));
    }

    const getSchema = requireTool("issues_get").inputSchema;
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
      assertThrows(() => getSchema.parse({ id: "ISSUE-001", projectDir }));
    }
  });

  it("uses annotations that match observable mutation behavior", () => {
    assertEquals(requireTool("issues_get").annotations?.readOnlyHint, true);
    assertEquals(requireTool("issues_list").annotations?.readOnlyHint, true);
    assertEquals(requireTool("issues_create").annotations?.idempotentHint, false);
    assertEquals(requireTool("issues_update").annotations?.idempotentHint, true);
    assertEquals(requireTool("issues_close").annotations?.idempotentHint, true);
    assertEquals(requireTool("issues_delete").annotations?.destructiveHint, true);
  });

  it("normalizes documented state aliases and keeps repeated close calls idempotent", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "issues-mcp-test-" });
    try {
      const create = requireTool("issues_create");
      const created = await create.execute(
        create.inputSchema.parse({ projectDir, title: "MCP state" }),
      );
      const update = requireTool("issues_update");
      const closedByAlias = await update.execute(
        update.inputSchema.parse({
          projectDir,
          id: created.metadata.id,
          state: "done",
        }),
      );
      assertEquals(closedByAlias?.metadata.state, "closed");

      const close = requireTool("issues_close");
      const first = await close.execute(
        close.inputSchema.parse({ projectDir, id: created.metadata.id }),
      );
      const second = await close.execute(
        close.inputSchema.parse({ projectDir, id: created.metadata.id }),
      );
      assertEquals(second, first);
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("executes the complete CRUD lifecycle through parsed MCP inputs", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "issues-mcp-lifecycle-test-" });
    try {
      const create = requireTool("issues_create");
      const first = await create.execute(
        create.inputSchema.parse({
          projectDir,
          title: "First",
          labels: ["bug"],
        }),
      );
      const second = await create.execute(
        create.inputSchema.parse({ projectDir, title: "Second" }),
      );

      const get = requireTool("issues_get");
      assertEquals(
        (await get.execute(
          get.inputSchema.parse({ projectDir, id: first.metadata.id }),
        ))?.metadata.id,
        first.metadata.id,
      );

      const list = requireTool("issues_list");
      const listed = await list.execute(
        list.inputSchema.parse({
          projectDir,
          labels: ["bug"],
          sortBy: "id",
          sortDirection: "asc",
        }),
      );
      assertEquals(listed.total, 1);
      assertEquals(listed.issues.map((issue) => issue.metadata.id), [
        first.metadata.id,
      ]);

      const update = requireTool("issues_update");
      const updated = await update.execute(
        update.inputSchema.parse({
          projectDir,
          id: first.metadata.id,
          title: "Updated",
          labels: [],
          assignees: [],
        }),
      );
      assertEquals(updated?.metadata.title, "Updated");
      assertEquals(updated?.metadata.labels, []);

      const close = requireTool("issues_close");
      assertEquals(
        (await close.execute(
          close.inputSchema.parse({ projectDir, id: first.metadata.id }),
        ))?.metadata.state,
        "closed",
      );

      const remove = requireTool("issues_delete");
      assertEquals(
        await remove.execute(
          remove.inputSchema.parse({ projectDir, id: second.metadata.id }),
        ),
        { deleted: true },
      );
      assertEquals(
        await remove.execute(
          remove.inputSchema.parse({ projectDir, id: second.metadata.id }),
        ),
        { deleted: false },
      );
      assertEquals(
        await get.execute(
          get.inputSchema.parse({ projectDir, id: second.metadata.id }),
        ),
        null,
      );
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });
});

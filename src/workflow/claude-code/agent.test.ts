import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { mergeAgentConfig, resolvePermissionMode } from "./agent.ts";
import type { ClaudeCodeMode } from "./types.ts";

describe("resolvePermissionMode", () => {
  it("maps 'code' mode to acceptEdits", () => {
    assertEquals(resolvePermissionMode({ mode: "code" }), "acceptEdits");
  });

  it("maps 'analysis' mode to plan", () => {
    assertEquals(resolvePermissionMode({ mode: "analysis" }), "plan");
  });

  it("maps 'custom' mode to default", () => {
    assertEquals(resolvePermissionMode({ mode: "custom" }), "default");
  });

  it("defaults to acceptEdits when no mode specified", () => {
    assertEquals(resolvePermissionMode({}), "acceptEdits");
  });

  it("returns bypassPermissions only when explicitly opted in", () => {
    assertEquals(
      resolvePermissionMode({ bypassPermissions: true }),
      "bypassPermissions",
    );
  });

  it("bypassPermissions flag overrides mode", () => {
    assertEquals(
      resolvePermissionMode({ mode: "analysis", bypassPermissions: true }),
      "bypassPermissions",
    );
  });

  it("bypassPermissions=false does not grant bypass", () => {
    assertEquals(
      resolvePermissionMode({ mode: "code", bypassPermissions: false }),
      "acceptEdits",
    );
  });

  it("truthy non-boolean bypassPermissions does not grant bypass", () => {
    assertEquals(
      resolvePermissionMode({
        mode: "analysis",
        bypassPermissions: "false" as unknown as boolean,
      }),
      "plan",
    );
  });

  it("'full' mode falls through to safe default (acceptEdits)", () => {
    // Even if unvalidated input somehow passes "full", it must NOT
    // resolve to bypassPermissions.
    const mode = "full" as ClaudeCodeMode;
    assertEquals(resolvePermissionMode({ mode }), "acceptEdits");
  });

  it("reusable-agent config strips bypassPermissions from overrides", () => {
    assertEquals(
      mergeAgentConfig(
        { mode: "analysis" },
        {
          mode: "analysis",
          bypassPermissions: true,
        },
      ),
      { mode: "analysis" },
    );
  });
});

describe("tool input schema", () => {
  it("does not accept 'full' as a valid mode value", async () => {
    const { claudeCodeTool } = await import("./tool.ts");
    const schema = claudeCodeTool.inputSchema;

    const result = schema.safeParse({
      task: "test task",
      mode: "full",
    });

    assertEquals(result.success, false, "'full' mode must be rejected by the input schema");
  });

  it("accepts valid mode values", async () => {
    const { claudeCodeTool } = await import("./tool.ts");
    const schema = claudeCodeTool.inputSchema;

    for (const mode of ["code", "analysis", "custom"]) {
      const result = schema.safeParse({ task: "test", mode });
      assertEquals(result.success, true, `'${mode}' should be accepted`);
    }
  });
});

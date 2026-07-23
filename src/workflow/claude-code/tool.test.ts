import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { AgentConfig } from "./agent.ts";
import {
  __createClaudeCodeToolForTests,
  claudeCodeTool,
  codeReviewTool,
  createClaudeCodeTool,
} from "./tool.ts";
import type { ClaudeCodeResult } from "./types.ts";

function successfulResult(): ClaudeCodeResult {
  return {
    success: true,
    iterations: 1,
    response: "done",
    filesModified: [],
    commandsExecuted: [],
    executionTime: 1,
  };
}

describe("Claude Code workflow tools", () => {
  it("applies bounded defaults through the standard tool parser", async () => {
    let receivedConfig: AgentConfig | undefined;
    const tool = __createClaudeCodeToolForTests(
      { defaultMode: "analysis", defaultMaxTurns: 7 },
      async (_task, config) => {
        receivedConfig = config;
        return successfulResult();
      },
    );

    await tool.execute({ task: "review" } as never);

    assertEquals(receivedConfig?.mode, "analysis");
    assertEquals(receivedConfig?.maxTurns, 7);
  });

  it("rejects missing tasks and invalid maxTurns before invoking the SDK", async () => {
    let calls = 0;
    const tool = __createClaudeCodeToolForTests({}, async () => {
      calls++;
      return successfulResult();
    });

    await assertRejects(() => tool.execute({} as never), Error, "input validation failed");
    await assertRejects(
      () => tool.execute({ task: "test", maxTurns: 0 } as never),
      Error,
      "input validation failed",
    );
    await assertRejects(
      () => tool.execute({ task: "test", maxTurns: 1.5 } as never),
      Error,
      "input validation failed",
    );
    await assertRejects(
      () => tool.execute({ task: "test", maxTurns: 101 } as never),
      Error,
      "input validation failed",
    );
    await assertRejects(
      () => tool.execute({ task: "test", context: { invalid: undefined } } as never),
      Error,
      "input validation failed",
    );
    assertEquals(calls, 0);
  });

  it("publishes the same bounds and defaults in JSON Schema", () => {
    const properties = claudeCodeTool.inputSchemaJson?.properties;
    assertEquals(properties?.task?.minLength, 1);
    assertEquals(properties?.mode?.default, "code");
    assertEquals(properties?.maxTurns?.default, 20);
    assertEquals(properties?.maxTurns?.minimum, 1);
    assertEquals(properties?.maxTurns?.maximum, 100);
    assertEquals(properties?.maxTurns?.type, "integer");

    const contextValueSchema = properties?.context?.additionalProperties;
    assertEquals(typeof contextValueSchema, "object");
    assertEquals(
      typeof contextValueSchema === "object" &&
        contextValueSchema !== null &&
        Array.isArray(contextValueSchema.anyOf) &&
        contextValueSchema.anyOf.some((schema) => schema.type === "null"),
      true,
    );
  });

  it("enforces codeReviewTool as analysis-only", () => {
    assertEquals(
      codeReviewTool.inputSchema.safeParse({ task: "review", mode: "analysis" }).success,
      true,
    );
    assertEquals(
      codeReviewTool.inputSchema.safeParse({ task: "review", mode: "code" }).success,
      false,
    );
    assertEquals(codeReviewTool.inputSchema.safeParse({ task: "review" }), {
      success: true,
      data: {
        task: "review",
        mode: "analysis",
        maxTurns: 10,
      },
    });
  });

  it("passes cancellation and trusted tool policies to executeAgent with debug off", async () => {
    const abortController = new AbortController();
    let receivedTask = "";
    let receivedConfig: AgentConfig | undefined;
    const tool = __createClaudeCodeToolForTests(
      {
        tools: ["Read", "Grep"],
        allowedTools: ["Read"],
      },
      async (task, config) => {
        receivedTask = task;
        receivedConfig = config;
        return successfulResult();
      },
    );

    await tool.execute(
      {
        task: "inspect",
        files: ["src/example.ts"],
        context: { reason: "regression" },
      } as never,
      { abortSignal: abortController.signal },
    );

    assertEquals(
      receivedTask,
      'inspect\n\nFocus on these files:\n- src/example.ts\n\nAdditional context:\n{\n  "reason": "regression"\n}',
    );
    assertEquals(receivedConfig?.abortSignal, abortController.signal);
    assertEquals(receivedConfig?.tools, ["Read", "Grep"]);
    assertEquals(receivedConfig?.allowedTools, ["Read"]);
    assertEquals(receivedConfig?.debug, undefined);
  });

  it("rejects invalid configured defaults", () => {
    for (const defaultMaxTurns of [0, 1.5, 101]) {
      assertThrows(
        () => createClaudeCodeTool({ defaultMaxTurns }),
        Error,
        "defaultMaxTurns",
      );
    }
  });
});

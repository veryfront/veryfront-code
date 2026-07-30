import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { register, unregister } from "../../extensions/contracts.ts";
import {
  createAgent,
  executeAgent,
  MAX_CLAUDE_CODE_AGENT_TURNS,
  mergeAgentConfig,
} from "./agent.ts";
import {
  type ClaudeCodeAgentExecutionConfig,
  type ClaudeCodeAgentRuntime,
  ClaudeCodeAgentRuntimeName,
} from "./runtime-contract.ts";
import type { ClaudeCodeResult } from "./types.ts";

function successfulResult(): ClaudeCodeResult {
  return {
    success: true,
    iterations: 1,
    response: "done",
    filesModified: [],
    commandsExecuted: [],
    executionTime: 5,
  };
}

function registerRuntime(
  execute: ClaudeCodeAgentRuntime["execute"],
): void {
  register<ClaudeCodeAgentRuntime>(ClaudeCodeAgentRuntimeName, { execute });
}

afterEach(() => unregister(ClaudeCodeAgentRuntimeName));

describe("executeAgent", () => {
  it("resolves the extension runtime and defaults to read-only analysis", async () => {
    let receivedTask: string | undefined;
    let receivedConfig: ClaudeCodeAgentExecutionConfig | undefined;
    registerRuntime((task, config) => {
      receivedTask = task;
      receivedConfig = config;
      return Promise.resolve(successfulResult());
    });

    const result = await executeAgent("Review the module");

    assertEquals(result.success, true);
    assertEquals(receivedTask, "Review the module");
    assertEquals(receivedConfig?.mode, "analysis");
    assertEquals(receivedConfig?.model, undefined);
    assertEquals(receivedConfig?.cwd, undefined);
  });

  it("fails with an actionable recommendation when the runtime is absent", async () => {
    await assertRejects(
      () => executeAgent("Review the module"),
      Error,
      "deno add npm:@veryfront/ext-claude-code-agent",
    );
  });

  it("snapshots mutable configuration before delegation", async () => {
    const allowedTools = ["Read"];
    const additionalDirectories = ["/workspace/shared"];
    let receivedConfig: ClaudeCodeAgentExecutionConfig | undefined;
    registerRuntime((_task, config) => {
      receivedConfig = config;
      return Promise.resolve(successfulResult());
    });

    await executeAgent("Review", { allowedTools, additionalDirectories });
    allowedTools.push("Bash");
    additionalDirectories.push("/workspace/other");

    assertEquals(receivedConfig?.allowedTools, ["Read"]);
    assertEquals(receivedConfig?.additionalDirectories, ["/workspace/shared"]);
  });

  it("awaits onComplete exactly once after validating the result", async () => {
    registerRuntime(() => Promise.resolve(successfulResult()));
    let callbacks = 0;
    let callbackFinished = false;

    const result = await executeAgent("Review", {
      onComplete: async (completed) => {
        callbacks++;
        assertEquals(completed, successfulResult());
        await Promise.resolve();
        callbackFinished = true;
      },
    });

    assertEquals(result, successfulResult());
    assertEquals(callbacks, 1);
    assertEquals(callbackFinished, true);
  });

  it("propagates callback failures without invoking the callback again", async () => {
    registerRuntime(() => Promise.resolve(successfulResult()));
    let callbacks = 0;

    await assertRejects(
      () =>
        executeAgent("Review", {
          onComplete: () => {
            callbacks++;
            throw new Error("observer failed");
          },
        }),
      Error,
      "observer failed",
    );
    assertEquals(callbacks, 1);
  });

  it("rejects invalid runtime results rather than treating them as success", async () => {
    registerRuntime(() =>
      Promise.resolve({
        success: false,
        iterations: 0,
        filesModified: [],
        commandsExecuted: [],
        executionTime: 1,
      } as ClaudeCodeResult)
    );

    await assertRejects(
      () => executeAgent("Review"),
      TypeError,
      "unsuccessful agent result must include an error",
    );
  });

  it("rejects invalid tasks and numeric limits before invoking the runtime", async () => {
    let calls = 0;
    registerRuntime(() => {
      calls++;
      return Promise.resolve(successfulResult());
    });

    await assertRejects(() => executeAgent("  "), TypeError, "non-empty string");
    await assertRejects(
      () => executeAgent("Review", { maxTurns: 0 }),
      RangeError,
      "maxTurns",
    );
    await assertRejects(
      () => executeAgent("Review", { maxTurns: MAX_CLAUDE_CODE_AGENT_TURNS + 1 }),
      RangeError,
      "maxTurns",
    );
    await assertRejects(
      () => executeAgent("Review", { maxBudgetUsd: Number.NaN }),
      RangeError,
      "maxBudgetUsd",
    );
    assertEquals(calls, 0);
  });

  it("rejects a pre-aborted request before invoking the runtime", async () => {
    let calls = 0;
    registerRuntime(() => {
      calls++;
      return Promise.resolve(successfulResult());
    });
    const controller = new AbortController();
    controller.abort(new Error("request cancelled"));

    await assertRejects(
      () => executeAgent("Review", { abortSignal: controller.signal }),
      Error,
      "request cancelled",
    );
    assertEquals(calls, 0);
  });
});

describe("createAgent", () => {
  it("snapshots defaults and prevents per-call permission escalation", async () => {
    const allowedTools = ["Read"];
    const received: ClaudeCodeAgentExecutionConfig[] = [];
    registerRuntime((_task, config) => {
      received.push(config);
      return Promise.resolve(successfulResult());
    });
    const agent = createAgent({ mode: "analysis", allowedTools });
    allowedTools.push("Bash");

    await agent("Review", { bypassPermissions: true });

    assertEquals(received[0]?.mode, "analysis");
    assertEquals(received[0]?.allowedTools, ["Read"]);
    assertEquals(received[0]?.bypassPermissions, undefined);
  });

  it("allows a per-call override to reduce server-enabled bypass privileges", () => {
    assertEquals(
      mergeAgentConfig(
        { mode: "code", bypassPermissions: true },
        { bypassPermissions: false },
      ).bypassPermissions,
      false,
    );
  });

  it("rejects a malformed truthy bypass flag", () => {
    assertThrows(
      () =>
        mergeAgentConfig(
          { bypassPermissions: "true" as unknown as boolean },
          {},
        ),
      TypeError,
      "bypassPermissions must be a boolean",
    );
  });
});

describe("tool input schema", () => {
  it("defaults omitted mode to read-only analysis", async () => {
    const { claudeCodeTool } = await import("./tool.ts");
    const result = claudeCodeTool.inputSchema.safeParse({ task: "test task" });
    assertEquals(result.success, true);
    if (result.success) assertEquals(result.data.mode, "analysis");
  });

  it("rejects the removed full-permission mode", async () => {
    const { claudeCodeTool } = await import("./tool.ts");
    const result = claudeCodeTool.inputSchema.safeParse({
      task: "test task",
      mode: "full",
    });
    assertEquals(result.success, false);
  });

  it("accepts explicit supported modes", async () => {
    const { claudeCodeTool } = await import("./tool.ts");
    for (const mode of ["code", "analysis", "custom"]) {
      assertEquals(
        claudeCodeTool.inputSchema.safeParse({ task: "test", mode }).success,
        true,
      );
    }
  });

  it("applies each customized tool's declared default mode", async () => {
    const { bugFixTool, codeReviewTool } = await import("./tool.ts");
    const bugFix = bugFixTool.inputSchema.safeParse({ task: "fix" });
    const review = codeReviewTool.inputSchema.safeParse({ task: "review" });
    assertEquals(bugFix.success, true);
    assertEquals(review.success, true);
    if (bugFix.success) assertEquals(bugFix.data.mode, "code");
    if (review.success) assertEquals(review.data.mode, "analysis");
  });

  it("forwards tool cancellation and rejects unsuccessful provider results", async () => {
    let receivedSignal: AbortSignal | undefined;
    registerRuntime((_task, config) => {
      receivedSignal = config.abortSignal;
      return Promise.resolve({
        success: false,
        iterations: 1,
        filesModified: [],
        commandsExecuted: [],
        error: "provider failed",
        executionTime: 1,
      });
    });
    const { claudeCodeTool } = await import("./tool.ts");
    const parsed = claudeCodeTool.inputSchema.safeParse({ task: "test" });
    if (!parsed.success) throw new Error("test input did not parse");
    const controller = new AbortController();

    await assertRejects(
      () => claudeCodeTool.execute(parsed.data, { abortSignal: controller.signal }),
      Error,
      "Claude Code agent execution failed: provider failed",
    );
    assertEquals(receivedSignal, controller.signal);
  });
});

import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import type {
  ClaudeCodeAgentExecutionConfig,
  ClaudeCodeResult,
} from "veryfront/workflow/claude-code/runtime";
import {
  AnthropicClaudeCodeAgentRuntime,
  type ClaudeAgentQuery,
  resolvePermissionMode,
} from "./runtime.ts";

type QueryParameters = Parameters<ClaudeAgentQuery>[0];

function config(
  overrides: Partial<ClaudeCodeAgentExecutionConfig> = {},
): ClaudeCodeAgentExecutionConfig {
  return { mode: "analysis", ...overrides };
}

function queryFrom(
  messages: readonly unknown[],
  capture?: (parameters: QueryParameters) => void,
): ClaudeAgentQuery {
  return ((parameters: QueryParameters) => {
    capture?.(parameters);
    return (async function* () {
      for (const message of messages) yield message;
    })();
  }) as unknown as ClaudeAgentQuery;
}

function successMessage(overrides: Record<string, unknown> = {}): unknown {
  return {
    type: "result",
    subtype: "success",
    num_turns: 1,
    result: "complete",
    total_cost_usd: 0.01,
    duration_ms: 10,
    ...overrides,
  };
}

describe("resolvePermissionMode", () => {
  it("maps analysis and omitted modes to read-only plan mode", () => {
    assertEquals(resolvePermissionMode(config()), "plan");
    assertEquals(
      resolvePermissionMode({} as ClaudeCodeAgentExecutionConfig),
      "plan",
    );
  });

  it("maps explicit code and custom modes without granting bypass", () => {
    assertEquals(resolvePermissionMode(config({ mode: "code" })), "acceptEdits");
    assertEquals(resolvePermissionMode(config({ mode: "custom" })), "default");
  });

  it("grants bypass only for an explicit boolean true", () => {
    assertEquals(
      resolvePermissionMode(config({ bypassPermissions: true })),
      "bypassPermissions",
    );
    assertThrows(
      () =>
        resolvePermissionMode(
          config({ bypassPermissions: "true" as unknown as boolean }),
        ),
      TypeError,
      "must be a boolean",
    );
  });
});

describe("AnthropicClaudeCodeAgentRuntime", () => {
  it("passes no hardcoded model and defaults to read-only SDK options", async () => {
    let received: QueryParameters | undefined;
    const runtime = new AnthropicClaudeCodeAgentRuntime({
      query: queryFrom([successMessage()], (parameters) => {
        received = parameters;
      }),
      now: (() => {
        const values = [100, 105];
        return () => values.shift() ?? 105;
      })(),
    });

    const result = await runtime.execute("Review", config());

    assertEquals(result.success, true);
    assertEquals(result.executionTime, 5);
    assertEquals(received?.options?.permissionMode, "plan");
    assertEquals(received?.options?.model, undefined);
    assertEquals(received?.options?.allowDangerouslySkipPermissions, undefined);
  });

  it("sets the SDK's mandatory dangerous-bypass acknowledgement", async () => {
    let received: QueryParameters | undefined;
    const runtime = new AnthropicClaudeCodeAgentRuntime({
      query: queryFrom([successMessage()], (parameters) => {
        received = parameters;
      }),
    });

    await runtime.execute(
      "Change files",
      config({ mode: "code", bypassPermissions: true }),
    );

    assertEquals(received?.options?.permissionMode, "bypassPermissions");
    assertEquals(received?.options?.allowDangerouslySkipPermissions, true);
  });

  it("tracks commands and modified files from assistant tool calls", async () => {
    const runtime = new AnthropicClaudeCodeAgentRuntime({
      query: queryFrom([
        {
          type: "assistant",
          message: {
            content: [
              { type: "tool_use", name: "Bash", input: { command: "deno test" } },
              { type: "tool_use", name: "Edit", input: { file_path: "src/a.ts" } },
              { type: "tool_use", name: "Write", input: { file_path: "src/a.ts" } },
            ],
          },
        },
        successMessage({ num_turns: 2 }),
      ]),
    });

    const result = await runtime.execute("Fix", config({ mode: "code" }));

    assertEquals(result.iterations, 2);
    assertEquals(result.commandsExecuted, ["deno test"]);
    assertEquals(result.filesModified, ["src/a.ts"]);
  });

  it("returns provider errors as an explicit unsuccessful result", async () => {
    const runtime = new AnthropicClaudeCodeAgentRuntime({
      query: queryFrom([{
        type: "result",
        subtype: "error_max_budget_usd",
        num_turns: 3,
        errors: ["budget exhausted"],
        total_cost_usd: 1,
        duration_ms: 10,
      }]),
    });

    const result = await runtime.execute("Fix", config());

    assertEquals(result.success, false);
    assertEquals(result.error, "budget exhausted");
    assertEquals(result.iterations, 3);
  });

  it("fails closed when the stream ends without a result message", async () => {
    const runtime = new AnthropicClaudeCodeAgentRuntime({
      query: queryFrom([]),
    });

    const result = await runtime.execute("Review", config());

    assertEquals(result.success, false);
    assertEquals(result.error, "Claude Agent SDK stream ended without a result message");
  });

  it("converts SDK execution failures to the documented result shape", async () => {
    const query = (() => {
      throw new Error("SDK unavailable");
    }) as unknown as ClaudeAgentQuery;
    const runtime = new AnthropicClaudeCodeAgentRuntime({ query });

    const result: ClaudeCodeResult = await runtime.execute("Review", config());

    assertEquals(result.success, false);
    assertEquals(result.error, "SDK unavailable");
    assertEquals(result.filesModified, []);
    assertEquals(result.commandsExecuted, []);
  });

  it("bridges caller cancellation into the SDK controller and propagates the reason", async () => {
    const caller = new AbortController();
    const runtime = new AnthropicClaudeCodeAgentRuntime({
      query: ((parameters: QueryParameters) => ({
        [Symbol.asyncIterator]() {
          return {
            next(): Promise<IteratorResult<unknown>> {
              caller.abort(new Error("workflow cancelled"));
              assertEquals(parameters.options?.abortController?.signal.aborted, true);
              return Promise.reject(parameters.options?.abortController?.signal.reason);
            },
          };
        },
      })) as unknown as ClaudeAgentQuery,
    });

    await assertRejects(
      () => runtime.execute("Review", config({ abortSignal: caller.signal })),
      Error,
      "workflow cancelled",
    );
  });

  it("rejects a backwards runtime clock instead of fabricating a duration", async () => {
    const runtime = new AnthropicClaudeCodeAgentRuntime({
      query: queryFrom([successMessage()]),
      now: (() => {
        const values = [10, 9, 8];
        return () => values.shift() ?? 8;
      })(),
    });

    await assertRejects(
      () => runtime.execute("Review", config()),
      Error,
      "runtime clock returned an invalid timestamp",
    );
  });
});

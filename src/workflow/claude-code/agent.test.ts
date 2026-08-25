import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ClaudeCodeMode } from "./types.ts";

const TEST_CWD = "/veryfront-test/workspace";
const TEST_WRITE_PATH = "/veryfront-test/workspace/a.ts";

/**
 * Mock the Claude Agent SDK import to capture the permissionMode
 * passed to query() — this lets us test the real resolvePermissionMode
 * logic inside executeAgent without requiring the actual SDK.
 */
function createMockSDK(messages?: unknown[]): {
  capturedOptions: Record<string, unknown> | null;
  install: () => void;
  uninstall: () => void;
} {
  let capturedOptions: Record<string, unknown> | null = null;
  let original: unknown;

  return {
    get capturedOptions() {
      return capturedOptions;
    },
    install() {
      original = (globalThis as Record<string, unknown>).__vfMockClaudeSDK;
      (globalThis as Record<string, unknown>).__vfMockClaudeSDK = {
        query(args: { prompt: string; options: Record<string, unknown> }) {
          capturedOptions = args.options;
          // Return an async iterable that immediately yields the scripted
          // conversation, defaulting to a single successful result message.
          const scripted = messages ?? [{
            type: "result",
            subtype: "success",
            result: "mocked",
            num_turns: 0,
            total_cost_usd: 0,
            duration_ms: 0,
          }];
          return (async function* () {
            for (const message of scripted) yield message;
          })();
        },
      };
    },
    uninstall() {
      if (original === undefined) {
        delete (globalThis as Record<string, unknown>).__vfMockClaudeSDK;
      } else {
        (globalThis as Record<string, unknown>).__vfMockClaudeSDK = original;
      }
      capturedOptions = null;
    },
  };
}

/**
 * Helper to execute the agent with a given config and return the
 * permissionMode that was passed to the SDK query() call.
 */
async function capturePermissionMode(
  config: { mode?: ClaudeCodeMode; bypassPermissions?: boolean },
): Promise<string> {
  const mock = createMockSDK();
  mock.install();
  try {
    const { executeAgent } = await import("./agent.ts");
    await executeAgent("test task", { ...config, cwd: TEST_CWD });
    return mock.capturedOptions?.permissionMode as string;
  } finally {
    mock.uninstall();
  }
}

// Verify the SDK mock mechanism is wired up in opaque-deps.
// Hard-fail if the mock doesn't work — silent skips hide regressions.
const sdkMockAvailable = await (async () => {
  const mock = createMockSDK();
  mock.install();
  try {
    const { executeAgent } = await import("./agent.ts");
    await executeAgent("probe", { cwd: TEST_CWD });
    return mock.capturedOptions !== null;
  } catch {
    return false;
  } finally {
    mock.uninstall();
  }
})();

if (!sdkMockAvailable) {
  throw new Error(
    "SDK mock not available — ensure opaque-deps.ts checks globalThis.__vfMockClaudeSDK and tests run with --allow-env",
  );
}

describe("resolvePermissionMode (via executeAgent)", () => {
  it("maps 'code' mode to acceptEdits", async () => {
    assertEquals(await capturePermissionMode({ mode: "code" }), "acceptEdits");
  });

  it("maps 'analysis' mode to plan", async () => {
    assertEquals(await capturePermissionMode({ mode: "analysis" }), "plan");
  });

  it("maps 'custom' mode to default", async () => {
    assertEquals(await capturePermissionMode({ mode: "custom" }), "default");
  });

  it("defaults to acceptEdits when no mode specified", async () => {
    assertEquals(await capturePermissionMode({}), "acceptEdits");
  });

  it("returns bypassPermissions only when explicitly opted in", async () => {
    assertEquals(
      await capturePermissionMode({ bypassPermissions: true }),
      "bypassPermissions",
    );
  });

  it("bypassPermissions flag overrides mode", async () => {
    assertEquals(
      await capturePermissionMode({ mode: "analysis", bypassPermissions: true }),
      "bypassPermissions",
    );
  });

  it("bypassPermissions=false does not grant bypass", async () => {
    assertEquals(
      await capturePermissionMode({ mode: "code", bypassPermissions: false }),
      "acceptEdits",
    );
  });

  it("truthy non-boolean bypassPermissions does not grant bypass", async () => {
    assertEquals(
      await capturePermissionMode({
        mode: "analysis",
        bypassPermissions: "false" as unknown as boolean,
      }),
      "plan",
    );
  });

  it("'full' mode falls through to safe default (acceptEdits)", async () => {
    // Even if unvalidated input somehow passes "full", it must NOT
    // resolve to bypassPermissions.
    const mode = "full" as ClaudeCodeMode;
    assertEquals(await capturePermissionMode({ mode }), "acceptEdits");
  });

  it("createAgent strips bypassPermissions from overrides", async () => {
    const mock = createMockSDK();
    mock.install();
    try {
      const { createAgent } = await import("./agent.ts");
      const reviewer = createAgent({ mode: "analysis" });
      await reviewer("test task", {
        mode: "analysis",
        bypassPermissions: true,
      });
      assertEquals(mock.capturedOptions?.permissionMode, "plan");
    } finally {
      mock.uninstall();
    }
  });
});

describe("executeAgent result mapping", () => {
  it("reports a non-success subtype as a failure and tracks its tool use", async () => {
    const mock = createMockSDK([
      {
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "done" },
            { type: "tool_use", name: "Bash", input: { command: "deno test" } },
            { type: "tool_use", name: "Write", input: { file_path: TEST_WRITE_PATH } },
          ],
        },
      },
      {
        type: "result",
        subtype: "error_max_turns",
        errors: ["max turns reached"],
        num_turns: 1,
        total_cost_usd: 0,
        duration_ms: 0,
      },
    ]);
    mock.install();
    try {
      const { executeAgent } = await import("./agent.ts");
      const result = await executeAgent("test task", { cwd: TEST_CWD });

      assertEquals(
        result.success,
        false,
        "a non-success SDK subtype must not be reported as success",
      );
      assertEquals(result.response, undefined, "a failed run must not report a response");
      assertEquals(result.error, "max turns reached", "the SDK errors must be surfaced");
      assertEquals(result.commandsExecuted, ["deno test"], "Bash commands must be tracked");
      assertEquals(result.filesModified, [TEST_WRITE_PATH], "written files must be tracked");
      assertEquals(result.iterations, 1, "the SDK turn count must be reported");
    } finally {
      mock.uninstall();
    }
  });

  it("reports a success subtype with its response", async () => {
    const mock = createMockSDK();
    mock.install();
    try {
      const { executeAgent } = await import("./agent.ts");
      const result = await executeAgent("test task", { cwd: TEST_CWD });

      assertEquals(result.success, true, "a success SDK subtype must be reported as success");
      assertEquals(result.response, "mocked", "the SDK result text must be surfaced");
      assertEquals(result.error, undefined, "a successful run must not report an error");
    } finally {
      mock.uninstall();
    }
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

  it("never lets tool input reach bypassPermissions", async () => {
    const mock = createMockSDK();
    mock.install();
    try {
      const { claudeCodeTool } = await import("./tool.ts");
      await claudeCodeTool.execute(
        { task: "t", mode: "analysis", bypassPermissions: true } as never,
        {} as never,
      );
      assertEquals(
        mock.capturedOptions?.permissionMode,
        "plan",
        "tool input must not be able to request bypassPermissions",
      );

      const parsed = claudeCodeTool.inputSchema.safeParse({ task: "t", bypassPermissions: true });
      assertEquals(parsed.success, true, "an unknown flag must not break parsing");
      const parsedData = (parsed as { data?: Record<string, unknown> }).data;
      assertEquals(
        parsedData?.bypassPermissions,
        undefined,
        "the input schema strips the server-side-only flag",
      );
    } finally {
      mock.uninstall();
    }
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

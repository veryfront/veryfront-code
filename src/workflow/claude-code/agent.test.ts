import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ClaudeCodeMode } from "./types.ts";

/**
 * Mock the Claude Agent SDK import to capture the permissionMode
 * passed to query() — this lets us test the real resolvePermissionMode
 * logic inside executeAgent without requiring the actual SDK.
 */
function createMockSDK(): {
  capturedOptions: Record<string, unknown> | null;
  install: () => void;
  uninstall: () => void;
} {
  let capturedOptions: Record<string, unknown> | null = null;
  const original = (globalThis as Record<string, unknown>).__vfMockClaudeSDK;

  return {
    get capturedOptions() {
      return capturedOptions;
    },
    install() {
      (globalThis as Record<string, unknown>).__vfMockClaudeSDK = {
        query(args: { prompt: string; options: Record<string, unknown> }) {
          capturedOptions = args.options;
          // Return an async iterable that immediately yields a result
          return (async function* () {
            yield {
              type: "result",
              subtype: "success",
              result: "mocked",
              num_turns: 0,
              total_cost_usd: 0,
              duration_ms: 0,
            };
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
    await executeAgent("test task", { ...config, cwd: "/tmp" });
    return mock.capturedOptions?.permissionMode as string;
  } finally {
    mock.uninstall();
  }
}

// Check if the SDK mock mechanism is wired up in opaque-deps.
// If not, fall back to testing the schema only. The mock requires
// opaque-deps.ts to check globalThis.__vfMockClaudeSDK first.
const sdkMockAvailable = await (async () => {
  try {
    const mock = createMockSDK();
    mock.install();
    const { executeAgent } = await import("./agent.ts");
    await executeAgent("probe", { cwd: "/tmp" });
    const ok = mock.capturedOptions !== null;
    mock.uninstall();
    return ok;
  } catch {
    return false;
  }
})();

describe("resolvePermissionMode (via executeAgent)", () => {
  if (!sdkMockAvailable) {
    it("requires SDK mock to be wired up", () => {
      throw new Error(
        "SDK mock not available — ensure opaque-deps.ts checks globalThis.__vfMockClaudeSDK and tests run with --allow-env",
      );
    });
    return;
  }

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

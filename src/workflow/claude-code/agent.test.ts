import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  __executeAgentForTests,
  applyClaudeCodeAgentOverridePolicy,
  type ClaudeCodeSDKImporter,
  resolveClaudeCodePermissionMode,
} from "./agent.ts";
import type { ClaudeCodeMode } from "./types.ts";

type QueryArguments = {
  prompt: string;
  options: Record<string, unknown>;
};

function successResult(response = "done", turns = 1): Record<string, unknown> {
  return {
    type: "result",
    subtype: "success",
    result: response,
    num_turns: turns,
    total_cost_usd: 0,
    duration_ms: 1,
  };
}

function createSDKImporter(
  query: (args: QueryArguments) => AsyncIterable<unknown>,
): ClaudeCodeSDKImporter {
  return (async () => ({ query })) as ClaudeCodeSDKImporter;
}

function messages(...items: unknown[]): AsyncIterable<unknown> {
  return (async function* () {
    for (const item of items) yield item;
  })();
}

function closableMessages(
  onClose: () => void,
  ...items: unknown[]
): AsyncIterable<unknown> & { close(): void } {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const item of items) yield item;
    },
    close: onClose,
  };
}

describe("resolveClaudeCodePermissionMode", () => {
  it("maps 'code' mode to acceptEdits", () => {
    assertEquals(resolveClaudeCodePermissionMode({ mode: "code" }), "acceptEdits");
  });

  it("maps 'analysis' mode to plan", () => {
    assertEquals(resolveClaudeCodePermissionMode({ mode: "analysis" }), "plan");
  });

  it("maps 'custom' mode to default", () => {
    assertEquals(resolveClaudeCodePermissionMode({ mode: "custom" }), "default");
  });

  it("defaults to acceptEdits when no mode is specified", () => {
    assertEquals(resolveClaudeCodePermissionMode({}), "acceptEdits");
  });

  it("returns bypassPermissions only when explicitly opted in", () => {
    assertEquals(
      resolveClaudeCodePermissionMode({ bypassPermissions: true }),
      "bypassPermissions",
    );
  });

  it("bypassPermissions flag overrides mode", () => {
    assertEquals(
      resolveClaudeCodePermissionMode({ mode: "analysis", bypassPermissions: true }),
      "bypassPermissions",
    );
  });

  it("bypassPermissions=false does not grant bypass", () => {
    assertEquals(
      resolveClaudeCodePermissionMode({ mode: "code", bypassPermissions: false }),
      "acceptEdits",
    );
  });

  it("truthy non-boolean bypassPermissions does not grant bypass", () => {
    assertEquals(
      resolveClaudeCodePermissionMode({
        mode: "analysis",
        bypassPermissions: "false" as unknown as boolean,
      }),
      "plan",
    );
  });

  it("rejects unknown runtime modes instead of granting write access", () => {
    const mode = "full" as ClaudeCodeMode;
    assertThrows(
      () => resolveClaudeCodePermissionMode({ mode }),
      Error,
      "Unsupported Claude Code mode",
    );
  });

  it("applies bypassPermissions only from server-controlled defaults", () => {
    const unprivileged = applyClaudeCodeAgentOverridePolicy(
      { mode: "analysis" },
      {
        mode: "analysis",
        bypassPermissions: true,
      },
    );
    assertEquals(unprivileged.bypassPermissions, undefined);
    assertEquals(resolveClaudeCodePermissionMode(unprivileged), "plan");

    const privileged = applyClaudeCodeAgentOverridePolicy(
      { mode: "analysis", bypassPermissions: true },
      { mode: "code", bypassPermissions: false },
    );
    assertEquals(privileged.bypassPermissions, true);
    assertEquals(resolveClaudeCodePermissionMode(privileged), "bypassPermissions");
  });
});

describe("executeAgent", () => {
  it("validates direct-call limits before importing the SDK", async () => {
    let importCalls = 0;
    const importer: ClaudeCodeSDKImporter = async () => {
      importCalls++;
      return { query: () => closableMessages(() => undefined, successResult()) };
    };

    for (
      const [task, config] of [
        ["", {}],
        ["task", { maxTurns: 0 }],
        ["task", { maxTurns: 1.5 }],
        ["task", { maxTurns: 101 }],
        ["task", { maxBudgetUsd: -1 }],
        ["task", { maxBudgetUsd: Number.POSITIVE_INFINITY }],
      ] as const
    ) {
      const result = await __executeAgentForTests(task, config, importer);
      assertEquals(result.success, false);
      assertEquals(typeof result.error, "string");
    }

    assertEquals(importCalls, 0);
  });

  it("uses a bounded default turn limit without hardcoding an SDK model", async () => {
    let invocation: QueryArguments | undefined;
    const result = await __executeAgentForTests(
      "task",
      {},
      createSDKImporter((args) => {
        invocation = args;
        return messages(successResult());
      }),
    );

    assertEquals(result.success, true);
    assertEquals(invocation?.options.maxTurns, 20);
    assertEquals(Object.hasOwn(invocation?.options ?? {}, "model"), false);
  });

  it("closes the SDK query exactly once after a result", async () => {
    let closeCalls = 0;
    const result = await __executeAgentForTests(
      "task",
      {},
      createSDKImporter(() => closableMessages(() => closeCalls++, successResult())),
    );

    assertEquals(result.success, true);
    assertEquals(closeCalls, 1);
  });

  it("sanitizes SDK diagnostics and supplies a fallback for empty error arrays", async () => {
    const localPath = ["", "workspace", "source.ts"].join("/");
    const unsafe = await __executeAgentForTests(
      "task",
      {},
      createSDKImporter(() =>
        messages({
          type: "result",
          subtype: "error_during_execution",
          errors: [`Failure at ${localPath}?token=<TOKEN>`],
          num_turns: 1,
        })
      ),
    );
    assertEquals(unsafe.success, false);
    assertEquals(unsafe.error?.includes(localPath), false);
    assertEquals(unsafe.error?.includes("token=<TOKEN>"), false);

    const empty = await __executeAgentForTests(
      "task",
      {},
      createSDKImporter(() =>
        messages({
          type: "result",
          subtype: "error_during_execution",
          errors: [],
          num_turns: 1,
        })
      ),
    );
    assertEquals(empty.success, false);
    assertEquals(typeof empty.error, "string");
    assertEquals((empty.error?.length ?? 0) > 0, true);
  });

  it("forwards availability and auto-approval separately and opts in to dangerous bypass", async () => {
    let invocation: QueryArguments | undefined;
    const importer = createSDKImporter((args) => {
      invocation = args;
      return messages(successResult());
    });

    const result = await __executeAgentForTests(
      "review",
      {
        bypassPermissions: true,
        tools: ["Read", "Grep"],
        allowedTools: ["Read"],
      },
      importer,
    );

    assertEquals(result.success, true);
    assertEquals(invocation?.prompt, "review");
    assertEquals(invocation?.options.permissionMode, "bypassPermissions");
    assertEquals(invocation?.options.allowDangerouslySkipPermissions, true);
    assertEquals(invocation?.options.tools, ["Read", "Grep"]);
    assertEquals(invocation?.options.allowedTools, ["Read"]);
  });

  it("awaits an async completion observer exactly once", async () => {
    let calls = 0;
    let releaseObserver!: () => void;
    let observerStarted!: () => void;
    const observerGate = new Promise<void>((resolve) => {
      releaseObserver = resolve;
    });
    const started = new Promise<void>((resolve) => {
      observerStarted = resolve;
    });
    let settled = false;

    const execution = __executeAgentForTests(
      "task",
      {
        onComplete: async () => {
          calls++;
          observerStarted();
          await observerGate;
        },
      },
      createSDKImporter(() => messages(successResult())),
    ).then((result) => {
      settled = true;
      return result;
    });

    await started;
    assertEquals(settled, false);
    releaseObserver();

    const result = await execution;
    assertEquals(result.success, true);
    assertEquals(calls, 1);
  });

  it("keeps a successful agent result when a synchronous observer throws", async () => {
    let calls = 0;
    const result = await __executeAgentForTests(
      "task",
      {
        onComplete: () => {
          calls++;
          throw new Error("observer failed");
        },
      },
      createSDKImporter(() => messages(successResult("success"))),
    );

    assertEquals(calls, 1);
    assertEquals(result.success, true);
    assertEquals(result.response, "success");
  });

  it("keeps a successful agent result when an async observer rejects", async () => {
    let calls = 0;
    const result = await __executeAgentForTests(
      "task",
      {
        onComplete: async () => {
          calls++;
          await Promise.resolve();
          throw new Error("observer failed");
        },
      },
      createSDKImporter(() => messages(successResult("success"))),
    );

    assertEquals(calls, 1);
    assertEquals(result.success, true);
    assertEquals(result.response, "success");
  });

  it("invokes the completion observer once after an SDK failure", async () => {
    let calls = 0;
    let observedSuccess: boolean | undefined;
    const importer: ClaudeCodeSDKImporter = async () => {
      throw new Error("SDK unavailable");
    };

    const result = await __executeAgentForTests(
      "task",
      {
        onComplete: (completed) => {
          calls++;
          observedSuccess = completed.success;
        },
      },
      importer,
    );

    assertEquals(result.success, false);
    assertEquals(result.error, "SDK unavailable");
    assertEquals(observedSuccess, false);
    assertEquals(calls, 1);
  });

  it("treats EOF without a result as failure and preserves observed state", async () => {
    let closeCalls = 0;
    const importer = createSDKImporter(() =>
      closableMessages(
        () => closeCalls++,
        {
          type: "assistant",
          message: {
            content: [
              { type: "text", text: "partial response" },
              { type: "tool_use", name: "Bash", input: { command: "deno test" } },
              { type: "tool_use", name: "Write", input: { file_path: "src/example.ts" } },
            ],
          },
        },
      )
    );

    const result = await __executeAgentForTests("task", {}, importer);

    assertEquals(result.success, false);
    assertEquals(result.iterations, 1);
    assertEquals(result.response, "partial response");
    assertEquals(result.commandsRequested, ["deno test"]);
    assertEquals(result.filesTargeted, ["src/example.ts"]);
    assertEquals(result.commandsExecuted, ["deno test"]);
    assertEquals(result.filesModified, ["src/example.ts"]);
    assertEquals(result.error, "Claude Agent SDK stream ended without a result message");
    assertEquals(closeCalls, 1);
  });

  it("closes the SDK query after iteration failure", async () => {
    let closeCalls = 0;
    const result = await __executeAgentForTests(
      "task",
      {},
      createSDKImporter(() => ({
        [Symbol.asyncIterator]() {
          return {
            next: () => Promise.reject(new Error("stream failed")),
          };
        },
        close: () => closeCalls++,
      })),
    );

    assertEquals(result.success, false);
    assertEquals(result.error, "stream failed");
    assertEquals(closeCalls, 1);
  });

  it("bridges cancellation to the SDK AbortController and removes the listener", async () => {
    const source = new AbortController();
    let sdkController: AbortController | undefined;
    let closeCalls = 0;
    let queryStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      queryStarted = resolve;
    });
    const importer = createSDKImporter((args) => {
      sdkController = args.options.abortController as AbortController;
      return {
        [Symbol.asyncIterator]: async function* () {
          queryStarted();
          await new Promise<void>((resolve) => {
            sdkController?.signal.addEventListener("abort", () => resolve(), { once: true });
          });
          yield { type: "cancelled" };
        },
        close: () => closeCalls++,
      };
    });

    const execution = __executeAgentForTests(
      "task",
      { abortSignal: source.signal },
      importer,
    );
    await started;
    source.abort(new Error("cancelled"));

    const result = await execution;
    assertEquals(sdkController?.signal.aborted, true);
    assertEquals(result.success, false);
    assertEquals(closeCalls, 1);

    const completedSource = new AbortController();
    let completedSDKController: AbortController | undefined;
    await __executeAgentForTests(
      "task",
      { abortSignal: completedSource.signal },
      createSDKImporter((args) => {
        completedSDKController = args.options.abortController as AbortController;
        return messages(successResult());
      }),
    );
    completedSource.abort();
    assertEquals(completedSDKController?.signal.aborted, false);
  });

  it("imports the public entrypoint without application bootstrap", async () => {
    const child = new Deno.Command(Deno.execPath(), {
      args: [
        "eval",
        "--config",
        "deno.json",
        'const api = await import("veryfront/workflow/claude-code"); if (typeof api.executeAgent !== "function") throw new Error("missing executeAgent");',
      ],
      stdout: "piped",
      stderr: "piped",
    });
    const output = await child.output();
    assertEquals(output.success, true, new TextDecoder().decode(output.stderr));
  });
});

describe("tool input schema", () => {
  it("does not accept 'full' as a valid mode value", async () => {
    const { claudeCodeTool } = await import("./tool.ts");
    const result = claudeCodeTool.inputSchema.safeParse({
      task: "test task",
      mode: "full",
    });

    assertEquals(result.success, false, "'full' mode must be rejected by the input schema");
  });

  it("accepts valid mode values", async () => {
    const { claudeCodeTool } = await import("./tool.ts");

    for (const mode of ["code", "analysis", "custom"]) {
      const result = claudeCodeTool.inputSchema.safeParse({ task: "test", mode });
      assertEquals(result.success, true, `'${mode}' should be accepted`);
    }
  });
});

import { createTerminalRunControl } from "#veryfront/agent/runtime/terminal-run-control.ts";
import { bindRuntimeRemoteToolSourcesToCredentialOwner } from "#veryfront/agent/runtime/mcp-server-tool-sources.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ParsedHostedChatRequest } from "./chat-request-parser.ts";
import type { RemoteMCPToolSourceConfig } from "#veryfront/tool/remote-mcp.ts";
import type { RemoteToolSource, ToolExecutionContext } from "#veryfront/tool/types.ts";
import {
  hostedTerminalToolSourceFactory,
  registerHostedTerminalCredential,
  RUN_TERMINAL_TOKEN_HEADER,
  RUN_TERMINAL_TOOL_CALL_ID_HEADER,
} from "./terminal-credential.ts";

const rootContext = () => createTerminalRunControl({ runId: "run-1" }).context;

const request = () =>
  ({
    projectId: "project-1",
    durableRootRun: { runId: "run-1" },
  }) as ParsedHostedChatRequest;

function recorder() {
  const calls: Array<{ endpoint: unknown; headers: Headers; name: string; args: unknown }> = [];
  const fallback = (config: RemoteMCPToolSourceConfig): RemoteToolSource => ({
    id: config.id ?? "platform",
    listTools: async () => [{
      name: "ordinary",
      description: "ordinary",
      parameters: { type: "object", properties: {} },
    }],
    executeTool: async (name, args, context) => {
      const headers = typeof config.headers === "function"
        ? await config.headers(context)
        : config.headers;
      const endpoint = typeof config.endpoint === "function"
        ? await config.endpoint(context)
        : config.endpoint;
      calls.push({ endpoint, headers: new Headers(headers), name, args });
      return { accepted: true };
    },
  });
  return { calls, fallback };
}

describe("private terminal credential routing", () => {
  it("does not activate terminal authority for an unbound or invalid request", () => {
    const { fallback } = recorder();
    assertEquals(
      hostedTerminalToolSourceFactory(undefined, "https://api.example/mcp", fallback),
      fallback,
    );
    for (
      const [value, token] of [
        [request(), undefined],
        [request(), ""],
        [request(), "x".repeat(16385)],
        [{ durableRootRun: { runId: "run-1" } }, "test-authority"],
        [{ projectId: "project-1" }, "test-authority"],
      ] as const
    ) {
      registerHostedTerminalCredential(value as ParsedHostedChatRequest, token);
      assertEquals(
        hostedTerminalToolSourceFactory(
          value as ParsedHostedChatRequest,
          "https://api.example/mcp",
          fallback,
        ),
        fallback,
      );
    }
  });

  for (const asyncHeaders of [false, true]) {
    it(`pins finalize to its bound project while preserving ordinary routing; asyncHeaders=${asyncHeaders}`, async () => {
      const value = request();
      registerHostedTerminalCredential(value, "test-authority");
      assert(!JSON.stringify(value).includes("test-authority"));
      const { calls, fallback } = recorder();
      const original = { Authorization: "Bearer test-invocation" };
      const factory = hostedTerminalToolSourceFactory(value, "https://api.example/mcp", fallback);
      const source = factory({
        id: "custom-platform",
        endpoint: () => "https://active.example/mcp",
        headers: asyncHeaders ? async () => original : original,
      }, { kind: "veryfront-api" });
      assertEquals(source.id, "custom-platform");
      assertEquals((await source.listTools()).map((tool) => tool.name), ["ordinary"]);
      for (
        const name of [
          "finalize",
          "veryfront__finalize",
          "succeed_run",
          "veryfront__succeed_run",
          "fail_run",
          "veryfront__fail_run",
        ]
      ) {
        await source.executeTool(name, {}, rootContext());
        const call = calls.at(-1)!;
        assertEquals(call.endpoint, "https://api.example/projects/project-1/mcp");
        assertEquals(call.headers.get(RUN_TERMINAL_TOKEN_HEADER), "test-authority");
        assertEquals(call.headers.get("Authorization"), original.Authorization);
      }
      for (const context of [{ runId: "run-other" }, { runId: "run-1" }]) {
        await source.executeTool("ordinary", {}, context);
        assertEquals(calls.at(-1)!.endpoint, "https://active.example/mcp");
        assertEquals(calls.at(-1)!.headers.get(RUN_TERMINAL_TOKEN_HEADER), null);
      }
      await source.executeTool("finalize", {}, { runId: "run-other" });
      assertEquals(calls.at(-1)!.headers.get(RUN_TERMINAL_TOKEN_HEADER), null);
      await source.executeTool("finalize", {}, undefined);
      assertEquals(calls.at(-1)!.headers.get(RUN_TERMINAL_TOKEN_HEADER), null);
      assertEquals(Object.keys(original), ["Authorization"]);
    });
  }

  it("names the finalize call beside its terminal credential so the API can close it", async () => {
    const value = request();
    registerHostedTerminalCredential(value, "test-authority");
    const { calls, fallback } = recorder();
    const source = hostedTerminalToolSourceFactory(value, "https://api.example/mcp", fallback)(
      { id: "platform", endpoint: "https://active.example/mcp" },
      { kind: "veryfront-api" },
    );
    await source.executeTool("veryfront__finalize", {}, {
      ...rootContext(),
      toolCallId: "call_fin",
    });
    assertEquals(calls.at(-1)!.headers.get(RUN_TERMINAL_TOOL_CALL_ID_HEADER), "call_fin");
    const key = calls.at(-1)!.headers.get("Idempotency-Key");
    assertEquals(key!.length, 64);
    await source.executeTool("veryfront__finalize", {}, {
      ...rootContext(),
      toolCallId: "call_fin",
    });
    assertEquals(calls.at(-1)!.headers.get("Idempotency-Key"), key);
    await source.executeTool("finalize", {}, { runId: "run-other", toolCallId: "call_fin" });
    assertEquals(calls.at(-1)!.headers.get(RUN_TERMINAL_TOOL_CALL_ID_HEADER), null);
    await source.executeTool("ordinary", {}, { runId: "run-1", toolCallId: "call_other" });
    assertEquals(calls.at(-1)!.headers.get(RUN_TERMINAL_TOOL_CALL_ID_HEADER), null);
    for (const context of [rootContext(), { ...rootContext(), toolCallId: "call\nfin" }]) {
      await source.executeTool("finalize", {}, context);
      assertEquals(calls.at(-1)!.headers.get(RUN_TERMINAL_TOKEN_HEADER), "test-authority");
      assertEquals(calls.at(-1)!.headers.get(RUN_TERMINAL_TOOL_CALL_ID_HEADER), null);
    }
  });

  it("withholds root authority from an in-process delegate despite credential-owner rebinding", async () => {
    const value = request();
    registerHostedTerminalCredential(value, "test-authority");
    const { calls, fallback } = recorder();
    const source = hostedTerminalToolSourceFactory(value, "https://api.example/mcp", fallback)(
      { endpoint: "https://api.example/mcp" },
      { kind: "veryfront-api" },
    );
    const root = rootContext();
    const child = createTerminalRunControl({ runId: "run-child" }).context;
    const inherited = bindRuntimeRemoteToolSourcesToCredentialOwner([source], root)![0]!;
    const unowned = bindRuntimeRemoteToolSourcesToCredentialOwner([source], {
      runId: "run-1",
    })![0]!;
    await unowned.executeTool("finalize", {}, root);
    assertEquals(calls.at(-1)!.headers.get(RUN_TERMINAL_TOKEN_HEADER), null);
    const grandchild = createTerminalRunControl({ runId: "run-grandchild" }).context;
    const deepInherited = bindRuntimeRemoteToolSourcesToCredentialOwner([inherited], child)![0]!;
    for (
      const name of [
        "finalize",
        "veryfront__finalize",
        "succeed_run",
        "veryfront__succeed_run",
        "fail_run",
        "veryfront__fail_run",
      ]
    ) {
      await deepInherited.executeTool(name, {}, grandchild);
      assertEquals(calls.at(-1)!.headers.get(RUN_TERMINAL_TOKEN_HEADER), null);
      await inherited.executeTool(name, {
        status: "failed",
        error: { code: "FAILED", message: "Failed" },
      }, child);
      assertEquals(calls.at(-1)!.headers.get(RUN_TERMINAL_TOKEN_HEADER), null);
      await source.executeTool(name, {}, root);
      assertEquals(calls.at(-1)!.headers.get(RUN_TERMINAL_TOKEN_HEADER), "test-authority");
    }
  });

  it("binds canonical run admission to the current durable parent and tool invocation", async () => {
    const value = request();
    const canonicalRunId = "33333333-3333-4333-8333-333333333333";
    const token = `header.${
      btoa(JSON.stringify({
        tokenUse: "run_event_writer",
        writerPurpose: "current_run_terminal",
        runId: "run-1",
        canonicalRunId,
        dispatchNonce: "dispatch-1",
      }))
    }.signature`;
    registerHostedTerminalCredential(value, token);
    const { calls, fallback } = recorder();
    const source = hostedTerminalToolSourceFactory(value, "https://api.example/mcp", fallback)(
      { endpoint: "https://active.example/mcp" },
      { kind: "veryfront-api" },
    );
    const args = {
      input: {
        project_id: "project-1",
        target: { type: "task", id: "echo" },
        input: { marker: "ok" },
      },
      idempotency_key: "task-once",
    };
    for (const name of ["create_run", "veryfront__create_run"]) {
      await source.executeTool(name, args, { ...rootContext(), toolCallId: "call-task" });
      assertEquals(calls.at(-1)!.args, {
        ...args,
        input: { ...args.input, parent_run_id: canonicalRunId, tool_call_id: "call-task" },
      });
      assertEquals(calls.at(-1)!.headers.get(RUN_TERMINAL_TOKEN_HEADER), null);
    }
    assertEquals(args.input, {
      project_id: "project-1",
      target: { type: "task", id: "echo" },
      input: { marker: "ok" },
    });
    for (
      const context of [{ runId: "run-1", toolCallId: "unowned" }, {
        ...rootContext(),
        runId: "run-other",
        toolCallId: "other",
      }]
    ) {
      await source.executeTool("create_run", args, context);
      assertEquals(calls.at(-1)!.args, args);
    }
  });

  it("never forwards terminal credentials to a non-platform source", async () => {
    const value = request();
    registerHostedTerminalCredential(value, "test-authority");
    const { calls, fallback } = recorder();
    const factory = hostedTerminalToolSourceFactory(value, "https://api.example/mcp", fallback);
    const source = factory({ endpoint: "https://third-party.example/mcp" });
    await source.executeTool(
      "veryfront__finalize",
      {},
      { runId: "run-1" } as ToolExecutionContext,
    );
    assertEquals(calls[0]!.endpoint, "https://third-party.example/mcp");
    assertEquals(calls[0]!.headers.get(RUN_TERMINAL_TOKEN_HEADER), null);
  });
});

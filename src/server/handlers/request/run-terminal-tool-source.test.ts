import { observeFetchRequestInit, withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { deleteEnv, getEnv, setEnv } from "#veryfront/compat/process.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { RemoteMCPToolSourceConfig } from "#veryfront/tool/remote-mcp.ts";
import type { RemoteToolSource } from "#veryfront/tool/types.ts";
import {
  createTerminalRunControl,
  RUN_TERMINAL_TOOL_CALL_ID_HEADER,
} from "#veryfront/agent/runtime/terminal-run-control.ts";
import { INGRESS_RUN_TERMINAL_TOKEN_HEADER } from "#veryfront/security/http/ingress-credentials.ts";
import { createRunPlatformToolSource } from "./run-terminal-tool-source.ts";

function recorder() {
  const calls: Array<{ headers: Headers; name: string }> = [];
  const create = (config: RemoteMCPToolSourceConfig): RemoteToolSource => ({
    id: config.id ?? "platform",
    listTools: async () => [],
    executeTool: async (name, _args, context) => {
      const headers = typeof config.headers === "function"
        ? await config.headers(context)
        : config.headers;
      calls.push({ headers: new Headers(headers), name });
      return { accepted: true };
    },
  });
  return { calls, create };
}

describe("control-plane run platform tool source", () => {
  it("names the finalize call beside its terminal credential so the API can close it", async () => {
    const { calls, create } = recorder();
    const source = createRunPlatformToolSource(
      {
        id: "platform",
        endpoint: "https://api.example/mcp",
        headers: { Authorization: "Bearer t" },
      },
      { token: "test-authority", runId: "run-1" },
      create,
    );
    await source.executeTool("veryfront__finalize", {}, {
      ...createTerminalRunControl({ runId: "run-1" }).context,
      toolCallId: "call_fin",
    });
    const finalize = calls.at(-1)!;
    assertEquals(finalize.headers.get(INGRESS_RUN_TERMINAL_TOKEN_HEADER), "test-authority");
    assertEquals(finalize.headers.get(RUN_TERMINAL_TOOL_CALL_ID_HEADER), "call_fin");
    assertEquals(finalize.headers.get("Authorization"), "Bearer t");
    const key = finalize.headers.get("Idempotency-Key");
    assertEquals(typeof key, "string");
    assertEquals(key!.length, 64);
    await source.executeTool("veryfront__finalize", {}, {
      ...createTerminalRunControl({ runId: "run-1" }).context,
      toolCallId: "call_fin",
    });
    assertEquals(calls.at(-1)!.headers.get("Idempotency-Key"), key);
    await source.executeTool("veryfront__finalize", {}, {
      ...createTerminalRunControl({ runId: "run-1" }).context,
      toolCallId: "call_other",
    });
    assertEquals(calls.at(-1)!.headers.get("Idempotency-Key") === key, false);

    for (
      const [name, context] of [
        ["finalize", { runId: "run-other", toolCallId: "call_fin" }],
        ["ordinary", { runId: "run-1", toolCallId: "call_other" }],
      ] as const
    ) {
      await source.executeTool(name, {}, context);
      assertEquals(calls.at(-1)!.headers.get(INGRESS_RUN_TERMINAL_TOKEN_HEADER), null);
      assertEquals(calls.at(-1)!.headers.get(RUN_TERMINAL_TOOL_CALL_ID_HEADER), null);
    }
    for (
      const context of [createTerminalRunControl({ runId: "run-1" }).context, {
        ...createTerminalRunControl({ runId: "run-1" }).context,
        toolCallId: "call\nfin",
      }]
    ) {
      await source.executeTool("finalize", {}, context);
      assertEquals(calls.at(-1)!.headers.get(INGRESS_RUN_TERMINAL_TOKEN_HEADER), "test-authority");
      assertEquals(calls.at(-1)!.headers.get(RUN_TERMINAL_TOOL_CALL_ID_HEADER), null);
    }
  });
});

describe("canonical file mutation authority", () => {
  it("binds retained authority only to the trusted API mutation calls", async () => {
    const { calls, create } = recorder();
    const source = createRunPlatformToolSource(
      {
        endpoint: "https://api.example/mcp",
        headers: { Authorization: "Bearer current-attempt" },
      },
      null,
      create,
      { apiBaseUrl: "https://api.example", token: "current-writer" },
    );
    await source.listTools({});
    for (
      const name of [
        "create_file",
        "update_file",
        "move_file",
        "delete_file",
        "update_project_file_draft",
        "delete_project_file_draft",
        "publish_project_files",
      ]
    ) {
      await source.executeTool(name, {}, {});
      assertEquals(calls.at(-1)!.headers.get("X-Veryfront-Run-Event-Token"), "current-writer");
      await source.executeTool(`veryfront__${name}`, {}, {});
      assertEquals(calls.at(-1)!.headers.get("X-Veryfront-Run-Event-Token"), "current-writer");
    }
    for (
      const name of [
        "veryfront__get_file",
        "veryfront__list_files",
        "veryfront__finalize",
        "other__update_file",
        "veryfront__write_sandbox_files",
        "veryfront__create_external_storage_file",
      ]
    ) {
      await source.executeTool(name, {}, {});
      assertEquals(calls.at(-1)!.headers.get("X-Veryfront-Run-Event-Token"), null);
    }
  });

  it("accepts only the host-configured HTTP API for mutation authority", async () => {
    const key = "VERYFRONT_API_URL";
    const previous = getEnv(key);
    setEnv(key, "http://localhost:4000");
    try {
      const { calls, create } = recorder();
      const source = createRunPlatformToolSource(
        { endpoint: "http://localhost:4000/mcp", headers: {} },
        null,
        create,
        { apiBaseUrl: "http://localhost:4000", token: "local-writer" },
      );
      await source.executeTool("veryfront__update_file", {}, {});
      assertEquals(calls.at(-1)!.headers.get("X-Veryfront-Run-Event-Token"), "local-writer");
      for (const apiBaseUrl of ["http://foreign.example", "http://localhost:4001"]) {
        assertThrows(() =>
          createRunPlatformToolSource(
            { endpoint: `${apiBaseUrl}/mcp`, headers: {} },
            null,
            create,
            { apiBaseUrl, token: "local-writer" },
          )
        );
      }
      assertEquals(calls.length, 1);
      await withMockFetch(async (_url, init) => {
        const body = JSON.parse(String(observeFetchRequestInit(init).body));
        return Response.json({ jsonrpc: "2.0", id: body.id, result: { tools: [] } });
      }, async () => {
        const remote = createRunPlatformToolSource(
          { endpoint: "http://localhost:4000/mcp", headers: {} },
          null,
          undefined,
          { apiBaseUrl: "http://localhost:4000", token: "local-writer" },
        );
        assertEquals(await remote.listTools({}), []);
      });
    } finally {
      if (previous === undefined) deleteEnv(key);
      else setEnv(key, previous);
    }
  });

  it("never sends signed authority to a foreign or dynamic MCP endpoint", async () => {
    const { calls, create } = recorder();
    for (
      const endpoint of [
        "https://foreign.example/mcp",
        () => "https://api.example/mcp",
        "http://api.example/mcp",
        "https://api.example/mcp?redirect=foreign",
      ]
    ) {
      let rejected = false;
      try {
        const source = createRunPlatformToolSource({ endpoint, headers: {} }, null, create, {
          apiBaseUrl: "https://api.example",
          token: "private-writer",
        });
        await source.executeTool("veryfront__update_file", {}, {});
      } catch {
        rejected = true;
      }
      assertEquals(rejected, true);
    }
    assertEquals(calls.length, 0);
  });
});

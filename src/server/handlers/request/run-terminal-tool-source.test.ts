import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { RemoteMCPToolSourceConfig } from "#veryfront/tool/remote-mcp.ts";
import type { RemoteToolSource } from "#veryfront/tool/types.ts";
import { RUN_TERMINAL_TOOL_CALL_ID_HEADER } from "#veryfront/agent/runtime/terminal-run-control.ts";
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
    await source.executeTool("veryfront__finalize", {}, { runId: "run-1", toolCallId: "call_fin" });
    const finalize = calls.at(-1)!;
    assertEquals(finalize.headers.get(INGRESS_RUN_TERMINAL_TOKEN_HEADER), "test-authority");
    assertEquals(finalize.headers.get(RUN_TERMINAL_TOOL_CALL_ID_HEADER), "call_fin");
    assertEquals(finalize.headers.get("Authorization"), "Bearer t");

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
    for (const context of [{ runId: "run-1" }, { runId: "run-1", toolCallId: "call\nfin" }]) {
      await source.executeTool("finalize", {}, context);
      assertEquals(calls.at(-1)!.headers.get(INGRESS_RUN_TERMINAL_TOKEN_HEADER), "test-authority");
      assertEquals(calls.at(-1)!.headers.get(RUN_TERMINAL_TOOL_CALL_ID_HEADER), null);
    }
  });
});

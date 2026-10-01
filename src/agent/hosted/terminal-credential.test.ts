import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ParsedHostedChatRequest } from "./chat-request-parser.ts";
import type { RemoteMCPToolSourceConfig } from "#veryfront/tool/remote-mcp.ts";
import type { RemoteToolSource, ToolExecutionContext } from "#veryfront/tool/types.ts";
import {
  hostedTerminalToolSourceFactory,
  registerHostedTerminalCredential,
  RUN_TERMINAL_TOKEN_HEADER,
} from "./terminal-credential.ts";

const request = () =>
  ({
    projectId: "project-1",
    durableRootRun: { runId: "run-1" },
  }) as ParsedHostedChatRequest;

function recorder() {
  const calls: Array<{ endpoint: unknown; headers: Headers; name: string }> = [];
  const fallback = (config: RemoteMCPToolSourceConfig): RemoteToolSource => ({
    id: config.id ?? "platform",
    listTools: async () => [{
      name: "ordinary",
      description: "ordinary",
      parameters: { type: "object", properties: {} },
    }],
    executeTool: async (name, _args, context) => {
      const headers = typeof config.headers === "function"
        ? await config.headers(context)
        : config.headers;
      const endpoint = typeof config.endpoint === "function"
        ? await config.endpoint(context)
        : config.endpoint;
      calls.push({ endpoint, headers: new Headers(headers), name });
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
    it(`pins finalized to its bound project while preserving ordinary routing; asyncHeaders=${asyncHeaders}`, async () => {
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
      for (const name of ["finalized", "veryfront__finalized"]) {
        await source.executeTool(name, {}, { runId: "run-1" });
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
      await source.executeTool("finalized", {}, { runId: "run-other" });
      assertEquals(calls.at(-1)!.headers.get(RUN_TERMINAL_TOKEN_HEADER), null);
      await source.executeTool("finalized", {}, undefined);
      assertEquals(calls.at(-1)!.headers.get(RUN_TERMINAL_TOKEN_HEADER), "test-authority");
      assertEquals(Object.keys(original), ["Authorization"]);
    });
  }

  it("never forwards terminal credentials to a non-platform source", async () => {
    const value = request();
    registerHostedTerminalCredential(value, "test-authority");
    const { calls, fallback } = recorder();
    const factory = hostedTerminalToolSourceFactory(value, "https://api.example/mcp", fallback);
    const source = factory({ endpoint: "https://third-party.example/mcp" });
    await source.executeTool(
      "veryfront__finalized",
      {},
      { runId: "run-1" } as ToolExecutionContext,
    );
    assertEquals(calls[0]!.endpoint, "https://third-party.example/mcp");
    assertEquals(calls[0]!.headers.get(RUN_TERMINAL_TOKEN_HEADER), null);
  });
});

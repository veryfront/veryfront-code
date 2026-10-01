import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { createRemoteMCPToolSource } from "#veryfront/tool/remote-mcp.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import type { ParsedHostedChatRequest } from "./chat-request-parser.ts";
import {
  hostedTerminalToolSourceFactory,
  registerHostedTerminalCredential,
  RUN_TERMINAL_TOKEN_HEADER,
} from "./terminal-credential.ts";

it("keeps terminal credentials private and pins transport to the bound project endpoint", async () => {
  const request = {
    projectId: "project-1",
    durableRootRun: { runId: "run-1" },
  } as ParsedHostedChatRequest;
  registerHostedTerminalCredential(request, "terminal-secret");
  assert(!JSON.stringify(request).includes("terminal-secret"));
  let fallbackCalls = 0;
  const factory = hostedTerminalToolSourceFactory(request, "https://api.example/mcp", (config) => {
    fallbackCalls++;
    return createRemoteMCPToolSource(config);
  });
  await withMockFetch(async (url, init) => {
    assertEquals(String(url), "https://api.example/projects/project-1/mcp");
    const headers = new Headers(init?.headers);
    assertEquals(headers.get(RUN_TERMINAL_TOKEN_HEADER), "terminal-secret");
    const body = JSON.parse(String(init?.body));
    return Response.json({ jsonrpc: "2.0", id: body.id, result: { tools: [] } });
  }, async () => {
    const source = factory({
      id: "custom-platform-name",
      endpoint: () => "https://untrusted.example/mcp",
    }, { kind: "veryfront-api", id: "custom-platform-name" });
    await source.executeTool("finalized", { status: "completed", output: "done" }, {
      runId: "run-1",
    });
  });
  assertEquals(fallbackCalls, 2);
});

it("keeps ordinary platform operations on the active project without terminal credentials", async () => {
  const request = {
    projectId: "project-1",
    durableRootRun: { runId: "run-1" },
  } as ParsedHostedChatRequest;
  registerHostedTerminalCredential(request, "terminal-secret");
  const factory = hostedTerminalToolSourceFactory(
    request,
    "https://api.example/mcp",
    createRemoteMCPToolSource,
  );
  let project = "project-1";
  const source = factory({
    id: "custom-platform",
    endpoint: () => `https://api.example/projects/${project}/mcp`,
  }, { kind: "veryfront-api" });
  project = "project-2";
  await withMockFetch(async (url, init) => {
    assertEquals(String(url), "https://api.example/projects/project-2/mcp");
    assertEquals(new Headers(init?.headers).get(RUN_TERMINAL_TOKEN_HEADER), null);
    const body = JSON.parse(String(init?.body));
    return Response.json({ jsonrpc: "2.0", id: body.id, result: { tools: [], content: [] } });
  }, async () => {
    await source.listTools();
    await source.executeTool("get_project", {}, { runId: "run-1" });
  });
});

it("preserves the deployment transport for a pinned private terminal endpoint", async () => {
  const request = {
    projectId: "project-1",
    durableRootRun: { runId: "run-1" },
  } as ParsedHostedChatRequest;
  registerHostedTerminalCredential(request, "terminal-secret");
  let dispatched = 0;
  const factory = hostedTerminalToolSourceFactory(request, "http://api.internal/mcp", (config) => ({
    id: config.id ?? "private",
    listTools: async () => [],
    executeTool: async (_name, _args, context) => {
      dispatched++;
      assertEquals(config.endpoint, "http://api.internal/projects/project-1/mcp");
      const headers = typeof config.headers === "function"
        ? await config.headers(context)
        : config.headers;
      assertEquals(new Headers(headers).get(RUN_TERMINAL_TOKEN_HEADER), "terminal-secret");
      return { completed: true };
    },
  }));
  await factory({ endpoint: "http://api.internal/mcp" }, { kind: "veryfront-api" }).executeTool(
    "finalized",
    { status: "completed", output: "done" },
    { runId: "run-1" },
  );
  assertEquals(dispatched, 1);
});

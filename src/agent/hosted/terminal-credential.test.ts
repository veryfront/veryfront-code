import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
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
  const factory = hostedTerminalToolSourceFactory(request, "https://api.example/mcp", () => {
    fallbackCalls++;
    throw new Error("credential must not reach a custom factory");
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
    await source.listTools();
  });
  assertEquals(fallbackCalls, 0);
});

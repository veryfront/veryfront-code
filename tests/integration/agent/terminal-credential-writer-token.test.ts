import "#veryfront/schemas/_test-setup.ts";
import { createTerminalRunControl } from "#veryfront/agent/runtime/terminal-run-control.ts";
import { bindRuntimeRemoteToolSourcesToCredentialOwner } from "#veryfront/agent/runtime/mcp-server-tool-sources.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { createRemoteMCPToolSource } from "#veryfront/tool/remote-mcp.ts";
import type { ToolExecutionContext } from "#veryfront/tool/types.ts";
import type { ParsedHostedChatRequest } from "#veryfront/agent/hosted/chat-request-parser.ts";
import {
  hostedTerminalToolSourceFactory,
  registerHostedTerminalCredential,
} from "#veryfront/agent/hosted/terminal-credential.ts";

const EVENT_TOKEN = "x-veryfront-run-event-token";
const DENIED = "[authorization-denied] A signed current run event writer authority is required";
const PROJECT_ENDPOINT = "https://api.example/projects/project-1/mcp";

const rootContext = () => ({
  ...createTerminalRunControl({ runId: "run-1" }).context,
  projectId: "project-1",
});

function platformSource(eventToken: string | undefined, headers?: Record<string, string>) {
  const request = {
    projectId: "project-1",
    durableRootRun: { runId: "run-1" },
  } as ParsedHostedChatRequest;
  registerHostedTerminalCredential(request, "terminal-token", eventToken);
  return hostedTerminalToolSourceFactory(
    request,
    "https://api.example/mcp",
    createRemoteMCPToolSource,
  )(
    { id: "platform", endpoint: PROJECT_ENDPOINT, ...(headers ? { headers } : {}) },
    { kind: "veryfront-api" },
  );
}

/** Calls the source over the real MCP transport against an API that requires writer authority. */
async function callPlatform(
  source: ReturnType<typeof platformSource>,
  context: ToolExecutionContext | undefined,
  name = "create_agent",
) {
  const sent: Array<{ url: string; eventToken: string | null }> = [];
  const result = await withMockFetch(async (url, init) => {
    const eventToken = new Headers(init?.headers).get(EVENT_TOKEN);
    sent.push({ url: String(url), eventToken });
    const body = JSON.parse(String(init?.body));
    return Response.json({
      jsonrpc: "2.0",
      id: body.id,
      result: eventToken === "event-token"
        ? { content: [{ type: "text", text: "created" }] }
        : { content: [{ type: "text", text: DENIED }], isError: true },
    });
  }, () => source.executeTool(name, { id: "agent-1" }, context));
  return { sent: sent.at(-1), denied: JSON.stringify(result).includes(DENIED) };
}

describe("hosted project MCP writer authority", () => {
  for (const name of ["create_agent", "veryfront__create_agent"]) {
    it(`carries the current run's event authority on ${name}`, async () => {
      const { sent, denied } = await callPlatform(
        platformSource("event-token"),
        rootContext(),
        name,
      );
      assertEquals(denied, false);
      assertEquals(sent, { url: PROJECT_ENDPOINT, eventToken: "event-token" });
    });
  }

  it("sends no run authority without a verified current run", async () => {
    assertEquals(
      (await callPlatform(platformSource(undefined), rootContext())).sent?.eventToken,
      null,
    );
    const source = platformSource("event-token");
    for (
      const context of [
        undefined,
        { runId: "run-1", projectId: "project-1" },
        { ...rootContext(), projectId: "project-2" },
        { ...createTerminalRunControl({ runId: "run-2" }).context, projectId: "project-1" },
      ]
    ) {
      const { sent, denied } = await callPlatform(source, context);
      assertEquals([sent?.eventToken, denied], [null, true]);
    }
  });

  it("never forwards run authority to a child or delegated run", async () => {
    const source = platformSource("event-token");
    const root = rootContext();
    const child = {
      ...createTerminalRunControl({ runId: "run-child" }).context,
      projectId: "project-1",
    };
    const inherited = bindRuntimeRemoteToolSourcesToCredentialOwner([source], root)![0]!;
    const unowned = bindRuntimeRemoteToolSourcesToCredentialOwner([source], {
      runId: "run-1",
    })![0]!;
    for (
      const [tools, context] of [[source, child], [inherited, child], [unowned, root]] as const
    ) {
      const { sent, denied } = await callPlatform(tools, context);
      assertEquals([sent?.eventToken, denied], [null, true]);
    }
    assertEquals((await callPlatform(source, root)).sent?.eventToken, "event-token");
  });

  it("never forwards run authority from configured headers", async () => {
    const source = platformSource("event-token", { [EVENT_TOKEN]: "caller-token" });
    assertEquals((await callPlatform(source, { runId: "run-9" })).sent?.eventToken, null);
    assertEquals((await callPlatform(source, rootContext())).sent?.eventToken, "event-token");
  });

  it("keeps create_run off the event authority route", async () => {
    const { sent } = await callPlatform(platformSource("event-token"), rootContext(), "create_run");
    assertEquals(sent?.eventToken, null);
  });
});

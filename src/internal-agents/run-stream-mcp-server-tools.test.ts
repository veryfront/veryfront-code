import "#veryfront/schemas/_test-setup.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { agent as createAgent, type AgentConfig } from "#veryfront/agent";
import { agentRegistry } from "#veryfront/agent/composition/index.ts";
import { scriptedModel } from "#veryfront/agent/runtime/model-runtime.test-helpers.ts";
import {
  WIKI_MCP_TOOLS,
  withMockMcpServer,
} from "#veryfront/agent/runtime/mcp-server.test-helpers.ts";
import { AgentRunSessionManager } from "./session-manager.ts";
import { createRuntimeAgentStreamResponse } from "./run-stream.ts";

/**
 * Run one hosted turn the way a Studio chat does: the run input injects the
 * `form_input` client tool, so the runtime's merged tool map is never empty.
 * Returns the sorted tool names the model received.
 */
async function toolsSentToModelInHostedRun(
  config: Omit<AgentConfig, "model" | "resolveModelTransport" | "system">,
  injectedTools: { name: string; description: string }[] = [
    { name: "form_input", description: "Ask the user for structured input" },
  ],
): Promise<string[]> {
  const model = scriptedModel([{ text: "done" }], {
    modelId: "anthropic/hosted-mcp-servers",
    provider: "anthropic",
    only: "stream",
  });
  const runtimeAgent = createAgent(
    {
      model: "anthropic/hosted-mcp-servers",
      system: "Answer questions about open source projects.",
      skills: false,
      maxSteps: 1,
      ...config,
      resolveModelTransport: () => ({ model }),
    } as Parameters<typeof createAgent>[0],
  );
  const response = await createRuntimeAgentStreamResponse(
    {
      threadId: crypto.randomUUID(),
      runId: `run_${crypto.randomUUID().replaceAll("-", "")}`,
      messages: [{ id: "user-1", role: "user", content: "Which sections does it have?" }],
      tools: injectedTools,
      context: [],
    },
    runtimeAgent,
    { sessionManager: new AgentRunSessionManager() },
  );
  await response.text();
  return model.toolNames().sort();
}

describe("internal-agents/run-stream mcpServers tool exposure (hosted path)", () => {
  afterEach(() => {
    agentRegistry.clearAll();
  });

  it("gives the model the external MCP server's tools beside the injected client tools", async () => {
    await withMockMcpServer(WIKI_MCP_TOOLS, async ({ url }) => {
      const names = await toolsSentToModelInHostedRun({
        id: "hosted-mcp-server-only",
        mcpServers: [{ id: "wiki", transport: { type: "http", url } }],
      });
      assertEquals(
        names,
        ["ask_wiki_question", "form_input", "read_wiki_contents", "read_wiki_structure"],
        "the configured server's tools and the injected client tool reach the model",
      );
    });
  });

  it("keeps the server's toolPolicy in a hosted run", async () => {
    await withMockMcpServer(WIKI_MCP_TOOLS, async ({ url }) => {
      const names = await toolsSentToModelInHostedRun({
        id: "hosted-mcp-server-allow",
        mcpServers: [{
          id: "wiki",
          transport: { type: "http", url },
          toolPolicy: { allow: ["read_wiki_structure"] },
        }],
      });
      assertEquals(
        names,
        ["form_input", "read_wiki_structure"],
        "tools outside the allow list stay excluded",
      );
    });
  });

  it("keeps a tools map that names some of the server's tools as the selection", async () => {
    await withMockMcpServer(WIKI_MCP_TOOLS, async ({ url }) => {
      const names = await toolsSentToModelInHostedRun({
        id: "hosted-mcp-server-explicit-map",
        tools: { ask_wiki_question: true },
        mcpServers: [{ id: "wiki", transport: { type: "http", url } }],
      });
      assertEquals(
        names,
        ["ask_wiki_question", "form_input"],
        "unnamed tools of that server stay excluded",
      );
    });
  });

  it("keeps the authored selection when the run injects no client tools", async () => {
    await withMockMcpServer(WIKI_MCP_TOOLS, async ({ url }) => {
      const names = await toolsSentToModelInHostedRun(
        {
          id: "hosted-mcp-server-explicit-map-no-client-tools",
          tools: { read_wiki_structure: true, ask_wiki_question: false },
          mcpServers: [{ id: "wiki", transport: { type: "http", url } }],
        },
        [],
      );
      assertEquals(
        names,
        ["read_wiki_structure"],
        "only the named tool reaches the model, and the false entry stays excluded",
      );
    });
  });
});

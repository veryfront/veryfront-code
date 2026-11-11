import "#veryfront/schemas/_test-setup.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { agent } from "#veryfront/agent";
import type { AgentConfig } from "#veryfront/agent";
import { agentRegistry } from "../composition/index.ts";
import { scriptedModel } from "./model-runtime.test-helpers.ts";
import { WIKI_MCP_TOOLS, withMockMcpServer } from "./mcp-server.test-helpers.ts";

const ALL_WIKI_TOOLS = ["ask_wiki_question", "read_wiki_contents", "read_wiki_structure"];

/** Run one `generate()` call and return the sorted tool names the model received. */
async function toolsSentToModel(
  config: Omit<AgentConfig, "model" | "resolveModelTransport" | "system">,
): Promise<string[]> {
  const model = scriptedModel([{ text: "done" }], { modelId: "hosted/mcp-exposure" });
  const assistant = agent({
    system: "Answer questions about open source projects.",
    skills: false,
    ...config,
    resolveModelTransport: () => Promise.resolve({ model }),
  });
  await assistant.generate({ input: "hello" });
  return model.toolNames().sort();
}

describe("agent mcpServers tool exposure (local generate path)", () => {
  afterEach(() => {
    agentRegistry.clearAll();
  });

  it("gives the model every tool of an external MCP server configured without a tools map", async () => {
    await withMockMcpServer(WIKI_MCP_TOOLS, async ({ url }) => {
      const names = await toolsSentToModel({
        id: "mcp-server-only",
        mcpServers: [{ id: "wiki", transport: { type: "http", url } }],
      });
      assertEquals(names, ALL_WIKI_TOOLS, "the configured server's tools reach the model");
    });
  });

  it("accepts the explicit http kind the same way", async () => {
    await withMockMcpServer(WIKI_MCP_TOOLS, async ({ url }) => {
      const names = await toolsSentToModel({
        id: "mcp-server-http-kind",
        mcpServers: [{ id: "wiki", kind: "http", transport: { type: "http", url } }],
      });
      assertEquals(names, ALL_WIKI_TOOLS, "kind: http behaves like the transport-only shape");
    });
  });

  it("limits the exposed tools to the server's toolPolicy allow list", async () => {
    await withMockMcpServer(WIKI_MCP_TOOLS, async ({ url }) => {
      const names = await toolsSentToModel({
        id: "mcp-server-allow",
        mcpServers: [{
          id: "wiki",
          transport: { type: "http", url },
          toolPolicy: { allow: ["read_wiki_structure"] },
        }],
      });
      assertEquals(names, ["read_wiki_structure"], "tools outside the allow list stay excluded");
    });
  });

  it("keeps a toolPolicy deny list excluded", async () => {
    await withMockMcpServer(WIKI_MCP_TOOLS, async ({ url }) => {
      const names = await toolsSentToModel({
        id: "mcp-server-deny",
        mcpServers: [{
          id: "wiki",
          transport: { type: "http", url },
          toolPolicy: { deny: ["ask_wiki_question"] },
        }],
      });
      assertEquals(
        names,
        ["read_wiki_contents", "read_wiki_structure"],
        "a denied tool never reaches the model",
      );
    });
  });

  it("exposes the server's tools beside a tools map that names none of them", async () => {
    await withMockMcpServer(WIKI_MCP_TOOLS, async ({ url }) => {
      const names = await toolsSentToModel({
        id: "mcp-server-beside-local",
        tools: { read_wiki_contents: false },
        mcpServers: [{ id: "wiki", transport: { type: "http", url } }],
      });
      assertEquals(
        names,
        ["ask_wiki_question", "read_wiki_structure"],
        "a tool set to false in the tools map stays excluded",
      );
    });
  });

  it("keeps a tools map that names some of the server's tools as the selection", async () => {
    await withMockMcpServer(WIKI_MCP_TOOLS, async ({ url }) => {
      const names = await toolsSentToModel({
        id: "mcp-server-explicit-map",
        tools: { ask_wiki_question: true },
        mcpServers: [{ id: "wiki", transport: { type: "http", url } }],
      });
      assertEquals(names, ["ask_wiki_question"], "unnamed tools of that server stay excluded");
    });
  });

  it("exposes nothing and contacts no server when tools is false", async () => {
    await withMockMcpServer(WIKI_MCP_TOOLS, async ({ url, requests }) => {
      const names = await toolsSentToModel({
        id: "mcp-server-tools-false",
        tools: false,
        mcpServers: [{ id: "wiki", transport: { type: "http", url } }],
      });
      assertEquals(names, [], "tools: false disables every tool");
      assertEquals(requests.includes("tools/list"), false, "the server is never listed");
    });
  });

  it("lets the model call a tool exposed this way", async () => {
    await withMockMcpServer(WIKI_MCP_TOOLS, async ({ url, requests }) => {
      const model = scriptedModel([
        { toolCalls: [{ id: "call-1", name: "read_wiki_structure", input: {} }] },
        { text: "done" },
      ], { modelId: "hosted/mcp-exposure" });
      const assistant = agent({
        id: "mcp-server-call",
        system: "Answer questions about open source projects.",
        skills: false,
        mcpServers: [{ id: "wiki", transport: { type: "http", url } }],
        resolveModelTransport: () => Promise.resolve({ model }),
      });

      const response = await assistant.generate({ input: "Which sections does it have?" });

      assertEquals(response.text, "done", "the run completes after the tool call");
      assertEquals(
        requests.filter((request) => request.startsWith("tools/call")),
        ["tools/call read_wiki_structure"],
        "the call reaches the MCP server exactly once",
      );
    });
  });
});

import "#veryfront/schemas/_test-setup.ts";
import type { Agent } from "#veryfront/agent/types.ts";
import { getAvailableTools } from "#veryfront/agent/runtime/tool-helpers.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { markTrustedPlatformSource } from "#veryfront/tool/platform-source-provenance.ts";
import { tool } from "#veryfront/tool/factory.ts";
import type { Tool, ToolDefinition } from "#veryfront/tool/types.ts";
import { buildMergedTools } from "./run-stream.ts";
import { AgentRunSessionManager } from "./session-manager.ts";

const definition = (name: string): ToolDefinition => ({
  name,
  description: name,
  parameters: { type: "object", properties: {} },
});

async function mixedManifest(
  configured: Record<string, boolean>,
  localTools?: Record<string, Tool | boolean>,
) {
  const allowed = ["veryfront__get_file", "veryfront__create_file", "outlook__get_email"];
  const agent = {
    id: "ingestion",
    config: { tools: configured, __vfAllowedRemoteTools: allowed },
  } as unknown as Agent;
  const source = markTrustedPlatformSource({
    id: "platform",
    listTools: async () => [...allowed, "veryfront__delete_file"].map(definition),
    executeTool: async () => ({ ok: true }),
  });
  const merged = buildMergedTools(
    agent,
    {
      runId: "run-selection",
      threadId: "thread",
      messages: [],
      context: [],
      tools: [],
    },
    new AgentRunSessionManager(),
    ["outlook__get_email"],
    localTools,
  );
  return (await getAvailableTools(merged, {
    callerAgentId: agent.id,
    includeIntegrationTools: false,
    allowedRemoteToolNames: allowed,
    remoteToolSources: [source],
  })).map((tool) => tool.name).sort();
}

describe("mixed platform and integration tool selection", () => {
  it("retains selected bare platform tools alongside an explicit integration tool", async () => {
    assertEquals(
      await mixedManifest({
        get_file: true,
        create_file: true,
        outlook__get_email: true,
      }),
      ["outlook__get_email", "veryfront__create_file", "veryfront__get_file"],
    );
  });

  it("keeps unselected or denied platform tools out of the model manifest", async () => {
    assertEquals(
      await mixedManifest({
        get_file: true,
        create_file: false,
        outlook__get_email: true,
      }),
      ["outlook__get_email", "veryfront__get_file"],
    );
  });

  it("honors an explicit canonical denial of a selected bare alias", async () => {
    assertEquals(
      await mixedManifest({
        get_file: true,
        veryfront__get_file: false,
        outlook__get_email: true,
      }),
      ["outlook__get_email"],
    );
  });

  it("preserves a project tool that uses a platform tool's bare name", async () => {
    const local = tool({
      id: "project-reader",
      description: "Read a project record",
      inputSchema: { type: "object", properties: {} },
      execute: async () => ({ local: true }),
    });
    assertEquals(
      await mixedManifest({ get_file: true, outlook__get_email: true }, {
        get_file: local,
      }),
      ["get_file", "outlook__get_email"],
    );
  });
});

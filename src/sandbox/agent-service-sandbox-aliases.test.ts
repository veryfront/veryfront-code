import { assertEquals } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import {
  type AgentServiceSandboxClientOptions,
  type AgentServiceSandboxToolsOptions,
  type AgentServiceSandboxToolsResult,
  createAgentServiceSandboxClient,
  createAgentServiceSandboxTools,
  createHostedSandboxClient,
  createHostedSandboxTools,
} from "./index.ts";

describe("sandbox/agent-service compatibility aliases", () => {
  it("points hosted factories at the agent-service factories", () => {
    assertEquals(createAgentServiceSandboxClient, createHostedSandboxClient);
    assertEquals(createAgentServiceSandboxTools, createHostedSandboxTools);
  });

  it("keeps agent-service aliases available as types", () => {
    const clientOptions: Partial<AgentServiceSandboxClientOptions> = {};
    const toolsOptions: Partial<AgentServiceSandboxToolsOptions> = {};
    const toolsResult: Partial<AgentServiceSandboxToolsResult> = {};

    assertEquals(clientOptions, {});
    assertEquals(toolsOptions, {});
    assertEquals(toolsResult, {});
  });
});

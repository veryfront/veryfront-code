import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  type AgentServiceSandboxClientOptions,
  type AgentServiceSandboxToolsOptions,
  type AgentServiceSandboxToolsResult,
  createAgentServiceSandboxClient,
  createAgentServiceSandboxTools,
  createHostedSandboxClient,
  createHostedSandboxTools,
  type HostedSandboxClientOptions,
  type HostedSandboxToolsOptions,
  type HostedSandboxToolsResult,
} from "./index.ts";

describe("sandbox/agent-service aliases", () => {
  it("hosted sandbox compatibility exports point at agent-service factories", () => {
    assertEquals(
      createAgentServiceSandboxClient,
      createHostedSandboxClient,
      "hosted client factory must be the agent-service client factory itself",
    );
    assertEquals(
      createAgentServiceSandboxTools,
      createHostedSandboxTools,
      "hosted tools factory must be the agent-service tools factory itself",
    );
  });

  it("agent-service sandbox aliases are available as types", () => {
    // Bidirectional assignability pins each alias pair to a single type, so a
    // hosted alias that stops aliasing its agent-service source fails typecheck.
    const _clientForward: HostedSandboxClientOptions = {} as AgentServiceSandboxClientOptions;
    const _clientBack: AgentServiceSandboxClientOptions = {} as HostedSandboxClientOptions;
    const _toolsOptionsForward: HostedSandboxToolsOptions = {} as AgentServiceSandboxToolsOptions;
    const _toolsOptionsBack: AgentServiceSandboxToolsOptions = {} as HostedSandboxToolsOptions;
    const _toolsResultForward: HostedSandboxToolsResult = {} as AgentServiceSandboxToolsResult;
    const _toolsResultBack: AgentServiceSandboxToolsResult = {} as HostedSandboxToolsResult;

    assertEquals(
      typeof createHostedSandboxTools,
      "function",
      "hosted tools factory must stay callable",
    );
  });
});

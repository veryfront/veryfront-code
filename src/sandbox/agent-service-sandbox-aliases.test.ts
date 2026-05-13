import { assertEquals } from "@std/assert";
import {
  type AgentServiceSandboxClientOptions,
  type AgentServiceSandboxToolsOptions,
  type AgentServiceSandboxToolsResult,
  createAgentServiceSandboxClient,
  createAgentServiceSandboxTools,
  createHostedSandboxClient,
  createHostedSandboxTools,
} from "./index.ts";

Deno.test("hosted sandbox compatibility exports point at agent-service factories", () => {
  assertEquals(createAgentServiceSandboxClient, createHostedSandboxClient);
  assertEquals(createAgentServiceSandboxTools, createHostedSandboxTools);
});

Deno.test("agent-service sandbox aliases are available as types", () => {
  const clientOptions: Partial<AgentServiceSandboxClientOptions> = {};
  const toolsOptions: Partial<AgentServiceSandboxToolsOptions> = {};
  const toolsResult: Partial<AgentServiceSandboxToolsResult> = {};

  assertEquals(clientOptions, {});
  assertEquals(toolsOptions, {});
  assertEquals(toolsResult, {});
});

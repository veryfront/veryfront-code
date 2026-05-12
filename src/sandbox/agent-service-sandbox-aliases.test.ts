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

Deno.test("agent-service sandbox aliases point at hosted compatibility exports", () => {
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

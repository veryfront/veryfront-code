/**
 * Owner-scope regression tests for internal-agent tool definitions
 * (review finding: buildMergedTools raw-loaded the tool registry).
 */

import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import type { Tool } from "#veryfront/tool";
import { clearMCPRegistry, registerTool } from "#veryfront/mcp";
import { buildMergedTools } from "./run-stream.ts";
import type { Agent } from "#veryfront/agent/types.ts";

function makeTool(id: string, ownerAgentId?: string): Tool {
  return {
    id,
    type: "function",
    description: `${id} test tool`,
    inputSchema: defineSchema((v) => v.object({}))(),
    execute: () => Promise.resolve({ ok: true }),
    ...(ownerAgentId === undefined ? {} : { ownerAgentId }),
  };
}

function makeAgent(id: string, tools: Agent["config"]["tools"]): Agent {
  return { id, config: { tools } } as unknown as Agent;
}

// deno-lint-ignore no-explicit-any -- test stub: only forwardedProps is read
const emptyInput = { runId: "run-1", tools: [], forwardedProps: {} } as any;
// deno-lint-ignore no-explicit-any -- test stub: unused on these paths
const sessionManager = {} as any;

Deno.test("buildMergedTools with tools: true excludes other agents' owned tools", () => {
  clearMCPRegistry();
  try {
    registerTool("global-echo", makeTool("global-echo"));
    registerTool("researcher--fetch", makeTool("researcher--fetch", "researcher"));

    const writerTools = buildMergedTools(makeAgent("writer", true), emptyInput, sessionManager);
    assertEquals(Object.keys(writerTools ?? {}).includes("global-echo"), true);
    assertEquals(Object.keys(writerTools ?? {}).includes("researcher--fetch"), false);

    const ownerTools = buildMergedTools(
      makeAgent("researcher", true),
      emptyInput,
      sessionManager,
    );
    assertEquals(Object.keys(ownerTools ?? {}).includes("researcher--fetch"), true);
  } finally {
    clearMCPRegistry();
  }
});

Deno.test("buildMergedTools named entry cannot bind another agent's owned tool", () => {
  clearMCPRegistry();
  try {
    registerTool("researcher--fetch", makeTool("researcher--fetch", "researcher"));

    const writerTools = buildMergedTools(
      makeAgent("writer", { "researcher--fetch": true }),
      emptyInput,
      sessionManager,
    );
    assertEquals(Object.keys(writerTools ?? {}).includes("researcher--fetch"), false);

    const ownerTools = buildMergedTools(
      makeAgent("researcher", { "researcher--fetch": true }),
      emptyInput,
      sessionManager,
    );
    assertEquals(Object.keys(ownerTools ?? {}).includes("researcher--fetch"), true);
  } finally {
    clearMCPRegistry();
  }
});

// ── Hosted host-tool spread (same review finding, hosted surface) ─────────

import { getDiscoveredHostTools } from "../agent/hosted/veryfront-cloud-agent-service.ts";

Deno.test("getDiscoveredHostTools excludes agent-owned tools from the host spread", () => {
  clearMCPRegistry();
  try {
    registerTool("global-echo", makeTool("global-echo"));
    registerTool("researcher--fetch", makeTool("researcher--fetch", "researcher"));

    const hostTools = getDiscoveredHostTools();
    assertEquals(Object.keys(hostTools).includes("global-echo"), true);
    assertEquals(Object.keys(hostTools).includes("researcher--fetch"), false);
  } finally {
    clearMCPRegistry();
  }
});

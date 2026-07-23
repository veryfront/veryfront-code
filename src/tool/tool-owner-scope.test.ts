/**
 * Owner-scope leak tests for tools (threat model: controlled-adoption plan).
 *
 * Covers: registry execution gating for agent-owned tools (explicit-id
 * access), external/MCP-shaped callers without agent identity, and MCP
 * tools/list / tools/call exposure.
 */

import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import type { Tool } from "./types.ts";
import { executeTool } from "./executor.ts";
import { clearMCPRegistry, registerTool } from "../mcp/registry.ts";
import { createMCPServer } from "../mcp/server.ts";

function makeTool(id: string, ownerAgentId?: string): Tool {
  return {
    id,
    type: "function",
    description: `${id} test tool`,
    inputSchema: defineSchema((v) => v.object({}))(),
    execute: () => Promise.resolve({ ok: true, id }),
    ...(ownerAgentId === undefined ? {} : { ownerAgentId }),
  };
}

function setupTools(): void {
  clearMCPRegistry();
  registerTool("global-echo", makeTool("global-echo"));
  registerTool("researcher--fetch", makeTool("researcher--fetch", "researcher"));
}

it("executeTool runs an owned tool for its owning agent", async () => {
  setupTools();
  try {
    const result = await executeTool("researcher--fetch", {}, { agentId: "researcher" });
    assertEquals(result, { ok: true, id: "researcher--fetch" });
  } finally {
    clearMCPRegistry();
  }
});

it("executeTool rejects an owned tool for another agent as not found", () => {
  setupTools();
  try {
    assertThrows(
      () => executeTool("researcher--fetch", {}, { agentId: "writer" }),
      Error,
      'Tool "researcher--fetch" not found',
    );
  } finally {
    clearMCPRegistry();
  }
});

it("executeTool rejects an owned tool without an agent context", () => {
  setupTools();
  try {
    assertThrows(
      () => executeTool("researcher--fetch", {}),
      Error,
      'Tool "researcher--fetch" not found',
    );
  } finally {
    clearMCPRegistry();
  }
});

it("MCP tools/list excludes agent-owned tools and keeps unowned ones", async () => {
  setupTools();
  try {
    const server = createMCPServer({
      enabled: true,
      auth: { type: "none", allowUnauthenticated: true },
    });
    const handler = server.createHTTPHandler();
    const response = await handler(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      }),
    );

    assertEquals(response.status, 200);
    const body = await response.json() as {
      result: { tools: Array<{ name: string }> };
    };
    const names = body.result.tools.map((tool) => tool.name);
    assertEquals(names.includes("global-echo"), true);
    assertEquals(names.includes("researcher--fetch"), false);
  } finally {
    clearMCPRegistry();
  }
});

it("MCP tools/call cannot execute an agent-owned tool", async () => {
  setupTools();
  try {
    const server = createMCPServer({
      enabled: true,
      auth: { type: "none", allowUnauthenticated: true },
    });
    const handler = server.createHTTPHandler();
    const response = await handler(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "researcher--fetch", arguments: {} },
        }),
      }),
    );

    const body = await response.json() as {
      result?: { isError?: boolean; content?: Array<{ text?: string }> };
      error?: { message?: string };
    };
    const text = JSON.stringify(body);
    assertEquals(text.includes("not found"), true);
    assertEquals(body.result?.isError === true || body.error !== undefined, true);
  } finally {
    clearMCPRegistry();
  }
});

// ── Model-facing tool definitions and runtime execution fallback ─────────

import { executeConfiguredTool, getAvailableTools } from "../agent/runtime/tool-helpers.ts";

it("getAvailableTools(true) excludes other agents' owned tools from model definitions", async () => {
  setupTools();
  try {
    const defs = await getAvailableTools(true, { callerAgentId: "writer" });
    const names = defs.map((def) => def.name);
    assertEquals(names.includes("global-echo"), true);
    assertEquals(names.includes("researcher--fetch"), false);

    const ownerDefs = await getAvailableTools(true, { callerAgentId: "researcher" });
    assertEquals(ownerDefs.map((def) => def.name).includes("researcher--fetch"), true);
  } finally {
    clearMCPRegistry();
  }
});

it("getAvailableTools named entry cannot bind another agent's owned tool", async () => {
  setupTools();
  try {
    // Binding another agent's owned tool by full id fails with an explicit
    // unknown-tool error whose enumeration lists only visible tools.
    let rejected = false;
    try {
      await getAvailableTools({ "researcher--fetch": true }, { callerAgentId: "writer" });
    } catch (error) {
      rejected = true;
      const message = String(error);
      assertEquals(message.includes("Unknown tool reference"), true);
      assertEquals(message.includes("Available tools: global-echo"), true);
      assertEquals(message.includes("global-echo, researcher--fetch"), false);
    }
    assertEquals(rejected, true);
  } finally {
    clearMCPRegistry();
  }
});

it("executeConfiguredTool registry fallback rejects another agent's owned tool", async () => {
  setupTools();
  try {
    await executeConfiguredTool("researcher--fetch", {}, undefined, { agentId: "researcher" });

    let rejected = false;
    try {
      await executeConfiguredTool("researcher--fetch", {}, undefined, { agentId: "writer" });
    } catch (error) {
      rejected = true;
      assertEquals(String(error).includes('Tool "researcher--fetch" not found'), true);
    }
    assertEquals(rejected, true);
  } finally {
    clearMCPRegistry();
  }
});

it("executeConfiguredTool with tools: true cannot execute another agent's owned tool", async () => {
  setupTools();
  try {
    // Owner still works through the configured path.
    const ok = await executeConfiguredTool("researcher--fetch", {}, true, {
      agentId: "researcher",
    });
    assertEquals(ok, { ok: true, id: "researcher--fetch" });

    let rejected = false;
    try {
      await executeConfiguredTool("researcher--fetch", {}, true, { agentId: "writer" });
    } catch (error) {
      rejected = true;
      assertEquals(String(error).includes('Tool "researcher--fetch" not found'), true);
    }
    assertEquals(rejected, true);
  } finally {
    clearMCPRegistry();
  }
});

it("executeConfiguredTool named registry entry cannot execute another agent's owned tool", async () => {
  setupTools();
  try {
    let rejected = false;
    try {
      await executeConfiguredTool(
        "researcher--fetch",
        {},
        { "researcher--fetch": true },
        { agentId: "writer" },
      );
    } catch (error) {
      rejected = true;
      assertEquals(String(error).includes('Tool "researcher--fetch" not found'), true);
    }
    assertEquals(rejected, true);
  } finally {
    clearMCPRegistry();
  }
});

import { assertEquals, assertThrows } from "@std/assert";
import {
  admitAgentsResponse,
  admitPromptsResponse,
  admitResourcesResponse,
  admitToolsResponse,
} from "./App.tsx";

Deno.test("dashboard overview admission validates every rendered collection", () => {
  assertEquals(
    admitToolsResponse({
      tools: [{
        id: "search",
        type: "function",
        description: "Search",
        schema: { properties: { query: { type: "string" } }, required: ["query"] },
        mcp: { enabled: true },
      }],
    })[0]?.id,
    "search",
  );
  assertEquals(
    admitResourcesResponse({
      resources: [{
        id: "docs",
        pattern: "docs://{path}",
        description: "Documentation",
        mcp: { enabled: true },
      }],
    })[0]?.pattern,
    "docs://{path}",
  );
  assertEquals(
    admitPromptsResponse({ prompts: [{ id: "review", description: "Review code" }] }),
    [{ id: "review", description: "Review code" }],
  );
  assertEquals(
    admitAgentsResponse({
      agents: [{
        id: "agent",
        description: "Agent",
        model: "model",
        system: null,
        tools: { search: true },
        memory: { type: "conversation" },
        streaming: true,
        maxSteps: null,
      }],
    })[0]?.memory,
    { type: "conversation" },
  );
});

Deno.test("dashboard overview admission rejects malformed nested values", () => {
  assertThrows(
    () =>
      admitToolsResponse({
        tools: [{
          id: "search",
          type: "function",
          description: "Search",
          schema: null,
          mcp: { enabled: "yes" },
        }],
      }),
    TypeError,
    "must be a boolean",
  );
  assertThrows(
    () => admitResourcesResponse({ resources: {} }),
    TypeError,
    "must be an array",
  );
  assertThrows(
    () => admitPromptsResponse({ prompts: [{ id: "review" }] }),
    TypeError,
    "must be a string",
  );
  assertThrows(
    () =>
      admitAgentsResponse({
        agents: [{
          id: "agent",
          description: "Agent",
          model: "model",
          system: null,
          tools: { search: "yes" },
          memory: null,
          streaming: true,
          maxSteps: null,
        }],
      }),
    TypeError,
    "must be a boolean",
  );
});

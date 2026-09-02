import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { AgentConfig } from "../types.ts";
import {
  applyAgUiRuntimeRestrictions,
  hasAgUiRuntimeRestrictions,
} from "./runtime-restrictions.ts";

function createConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: "researcher",
    system: "Answer directly.",
    model: "anthropic/claude-sonnet-4-6",
    tools: { web_search: true, delete_project: true },
    providerTools: ["web_fetch"],
    delegates: ["writer"],
    skills: true,
    maxSteps: 20,
    mcpServers: [{ kind: "veryfront-api" }],
    ...overrides,
  } as AgentConfig;
}

describe("agent/ag-ui/runtime-restrictions", () => {
  it("reports whether a restriction set narrows anything", () => {
    assertEquals(hasAgUiRuntimeRestrictions(undefined), false);
    assertEquals(hasAgUiRuntimeRestrictions({}), false);
    assertEquals(hasAgUiRuntimeRestrictions({ maxSteps: 2 }), true);
    assertEquals(hasAgUiRuntimeRestrictions({ allowedTools: [] }), true);
  });

  it("keeps only allowlisted configured tools", () => {
    const restricted = applyAgUiRuntimeRestrictions(createConfig(), {
      allowedTools: ["web_search"],
    });

    assertEquals(restricted.tools, { web_search: true });
    assertEquals(restricted.providerTools, []);
    assertEquals(restricted.delegates, []);
    assertEquals(restricted.mcpServers, undefined);
    assertEquals(restricted.skills, false);
  });

  it("authorizes no tools for an empty allowlist", () => {
    const restricted = applyAgUiRuntimeRestrictions(createConfig(), { allowedTools: [] });

    assertEquals(restricted.tools, {});
    assertEquals(restricted.providerTools, []);
    assertEquals(restricted.delegates, []);
    assertEquals(restricted.mcpServers, undefined);
    assertEquals(restricted.skills, false);
  });

  it("replaces an unrestricted tool catalog with the allowlisted names", () => {
    const restricted = applyAgUiRuntimeRestrictions(createConfig({ tools: true }), {
      allowedTools: ["web_search", "read_file"],
    });

    assertEquals(restricted.tools, { web_search: true, read_file: true });
  });

  it("keeps allowlisted provider tools, delegates, and skills", () => {
    const restricted = applyAgUiRuntimeRestrictions(createConfig(), {
      allowedTools: ["web_fetch", "agent_writer", "load_skill"],
    });

    assertEquals(restricted.providerTools, ["web_fetch"]);
    assertEquals(restricted.delegates, ["writer"]);
    assertEquals(restricted.skills, true);
  });

  it("never raises the configured step bound", () => {
    assertEquals(
      applyAgUiRuntimeRestrictions(createConfig({ maxSteps: 20 }), { maxSteps: 2 }).maxSteps,
      2,
    );
    assertEquals(
      applyAgUiRuntimeRestrictions(createConfig({ maxSteps: 1 }), { maxSteps: 5 }).maxSteps,
      1,
    );
    assertEquals(
      applyAgUiRuntimeRestrictions(createConfig({ maxSteps: undefined }), { maxSteps: 3 }).maxSteps,
      3,
    );
  });

  it("leaves the tool surface alone when only the step bound is restricted", () => {
    const config = createConfig();
    const restricted = applyAgUiRuntimeRestrictions(config, { maxSteps: 2 });

    assertEquals(restricted.tools, config.tools);
    assertEquals(restricted.providerTools, config.providerTools);
    assertEquals(restricted.mcpServers, config.mcpServers);
    assertEquals(restricted.skills, true);
  });
});

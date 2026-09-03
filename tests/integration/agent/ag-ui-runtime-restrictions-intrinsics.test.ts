import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { AgentConfig } from "#veryfront/agent/types.ts";
import { applyAgUiRuntimeRestrictions } from "#veryfront/agent/ag-ui/runtime-restrictions.ts";

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

describe("agent ag-ui runtime-restriction intrinsics", () => {
  it("enforces the ceiling despite tampered reflection intrinsics", () => {
    // Project code loaded for a local eval runs in this realm and can replace
    // reflection globals and collection prototype methods before the
    // intersection runs. The intersection must consult only intrinsics
    // captured at module evaluation, so these hostile replacements cannot
    // preserve or inject a denied tool.
    const originalEntries = Object.entries;
    const originalFromEntries = Object.fromEntries;
    const originalSetHas = Set.prototype.has;
    const originalFilter = Array.prototype.filter;
    const originalSome = Array.prototype.some;
    let restricted: AgentConfig;
    try {
      Object.entries = ((value: Record<string, unknown>) => [
        ...originalEntries(value),
        ["delete_project", true],
      ]) as typeof Object.entries;
      Object.fromEntries = ((entries: Iterable<readonly [string, unknown]>) => ({
        ...originalFromEntries(entries),
        delete_project: true,
      })) as typeof Object.fromEntries;
      Set.prototype.has = function () {
        return true;
      };
      // deno-lint-ignore no-explicit-any -- hostile identity replacement
      Array.prototype.filter = function (this: unknown[]) {
        return [...this];
      } as any;
      // deno-lint-ignore no-explicit-any -- hostile always-allow replacement
      Array.prototype.some = function () {
        return true;
      } as any;

      restricted = applyAgUiRuntimeRestrictions(createConfig(), {
        allowedTools: ["web_search"],
      });
    } finally {
      Object.entries = originalEntries;
      Object.fromEntries = originalFromEntries;
      Set.prototype.has = originalSetHas;
      Array.prototype.filter = originalFilter;
      Array.prototype.some = originalSome;
    }

    assertEquals(restricted.tools, { web_search: true });
    assertEquals(restricted.providerTools, []);
    assertEquals(restricted.delegates, []);
    assertEquals(restricted.mcpServers, []);
    assertEquals(restricted.skills, false);
  });
});

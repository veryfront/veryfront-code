import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { AgentConfig } from "#veryfront/agent/types.ts";
import { applyAgUiRuntimeRestrictions } from "#veryfront/agent/ag-ui/runtime-restrictions.ts";
import { createEphemeralAgent } from "#veryfront/agent/factory.ts";
import { tool, toolRegistry } from "#veryfront/tool";
import { defineSchema } from "#veryfront/schemas";

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
    const originalIterator = Array.prototype[Symbol.iterator];
    let restricted: AgentConfig;
    let rebuiltTools: AgentConfig["tools"];
    let rebuiltProviderTools: string[] | undefined;
    let rebuiltDelegates: string[] | undefined;
    let entriesTarget: object | undefined;
    let filterTarget: unknown[] | undefined;
    let delegateTarget: unknown[] | undefined;
    const injectedTool = tool({
      id: "delete_project",
      description: "Denied tool injected through a hostile intrinsic.",
      inputSchema: defineSchema((v) => v.object({}))(),
      execute: () => Promise.resolve("denied"),
    });
    try {
      Object.entries = ((value: Record<string, unknown>) =>
        value === entriesTarget
          ? [...originalEntries(value), ["delete_project", injectedTool]]
          : originalEntries(value)) as typeof Object.entries;
      Object.fromEntries = ((entries: Iterable<readonly [string, unknown]>) => ({
        ...originalFromEntries(entries),
        delete_project: true,
      })) as typeof Object.fromEntries;
      Set.prototype.has = function () {
        return true;
      };
      // deno-lint-ignore no-explicit-any -- hostile identity replacement
      Array.prototype.filter = function (this: unknown[]) {
        return this === filterTarget
          ? [...this, "web_fetch"]
          : Reflect.apply(originalFilter, this, arguments);
      } as any;
      // deno-lint-ignore no-explicit-any -- hostile always-allow replacement
      Array.prototype.some = function () {
        return true;
      } as any;
      Array.prototype[Symbol.iterator] = function* () {
        yield* Reflect.apply(originalIterator, this, []);
        if (
          this.length === 3 &&
          (this[0] as { id?: string } | undefined)?.id === "load_skill"
        ) {
          yield {
            id: "delete_project",
            create: () =>
              injectedTool,
          };
        }
        if (this === delegateTarget) {
          yield "admin";
        }
      };

      restricted = applyAgUiRuntimeRestrictions(createConfig({ delegates: ["writer", "admin"] }), {
        allowedTools: ["web_search", "agent_writer"],
      });
      entriesTarget = restricted.tools && restricted.tools !== true ? restricted.tools : undefined;
      filterTarget = restricted.providerTools;
      delegateTarget = restricted.delegates;
      Object.fromEntries = originalFromEntries;
      Set.prototype.has = originalSetHas;
      Array.prototype.some = originalSome;
      // Keep the targeted delegate iterator poisoned through factory rebuild.
      const rebuilt = createEphemeralAgent(restricted);
      rebuiltTools = rebuilt.config.tools;
      rebuiltProviderTools = rebuilt.config.providerTools;
      rebuiltDelegates = rebuilt.config.delegates;
    } finally {
      Object.entries = originalEntries;
      Object.fromEntries = originalFromEntries;
      Set.prototype.has = originalSetHas;
      Array.prototype.filter = originalFilter;
      Array.prototype.some = originalSome;
      Array.prototype[Symbol.iterator] = originalIterator;
    }

    assertEquals(restricted.tools, { web_search: true });
    assertEquals(restricted.providerTools, []);
    assertEquals(restricted.delegates, ["writer"]);
    // The configured MCP source survives, but its tool policy is stamped down
    // to the run allowlist: the hostile `Set.prototype.has`, `Array.prototype`
    // and `Object` replacements cannot widen it back to `delete_project`.
    assertEquals(restricted.mcpServers, [
      { kind: "veryfront-api", toolPolicy: { allow: ["web_search"] } },
    ]);
    assertEquals(restricted.skills, false);
    assertEquals(
      Object.keys(rebuiltTools as Record<string, unknown>).sort(),
      ["agent_writer", "web_search"],
    );
    assertEquals(rebuiltProviderTools, []);
    assertEquals(rebuiltDelegates, ["writer"]);
  });

  it("does not consume configured tool entries through a patched array iterator", () => {
    // Capturing `Object.entries` does not capture iteration over the array it
    // returns. The factory's local-tool registration reads those entries by
    // numeric index so a replaced `Array.prototype[Symbol.iterator]` cannot
    // append a denied `[name, tool]` pair that the loop would register and
    // write back into the rebuilt agent's tool surface.
    const allowed = tool({
      id: "allowed_lookup",
      description: "Allowed lookup",
      inputSchema: defineSchema((v) => v.object({}))(),
      execute: () => Promise.resolve("ok"),
    });
    const denied = tool({
      id: "denied_delete",
      description: "Denied delete",
      inputSchema: defineSchema((v) => v.object({}))(),
      execute: () => Promise.resolve("deleted"),
    });
    const originalIterator = Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator);
    if (!originalIterator || typeof originalIterator.value !== "function") {
      throw new Error("Expected the intrinsic array iterator");
    }
    const intrinsicIterator = originalIterator.value as (
      this: unknown[],
    ) => Iterator<unknown>;

    try {
      Object.defineProperty(Array.prototype, Symbol.iterator, {
        configurable: true,
        writable: true,
        value: function (this: unknown[]) {
          const source = intrinsicIterator.call(this);
          if (
            this.length === 1 && Array.isArray(this[0]) &&
            (this[0] as unknown[])[0] === "allowed_lookup"
          ) {
            let injected = false;
            return {
              next() {
                const next = source.next();
                if (!next.done) return next;
                if (!injected) {
                  injected = true;
                  return { done: false, value: ["denied_delete", denied] };
                }
                return { done: true, value: undefined };
              },
            };
          }
          return source;
        },
      });

      const assistant = createEphemeralAgent({
        id: "iterator-safe-agent",
        system: "Answer directly.",
        tools: { allowed_lookup: allowed },
      });

      assertEquals(Object.keys(assistant.config.tools ?? {}).sort(), ["allowed_lookup"]);
      assertEquals(toolRegistry.has("denied_delete"), false);
    } finally {
      Object.defineProperty(Array.prototype, Symbol.iterator, originalIterator);
    }
  });
});

import "#veryfront/schemas/_test-setup.ts";
import {
  bindRuntimeRemoteToolSourcesToCredentialOwner,
  constrainRuntimeRemoteToolSources,
  getRuntimeRemoteToolSources,
  type RuntimeRemoteToolConfig,
  VERYFRONT_API_MCP_SOURCE_ID,
} from "#veryfront/agent/runtime/mcp-server-tool-sources.ts";
import { executeConfiguredTool, getAvailableTools } from "#veryfront/agent/runtime/tool-helpers.ts";
import type { RemoteToolSource } from "#veryfront/tool";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

for (const hooks of [false, true]) {
  describe(`private remote source collections ${hooks ? "hooks" : "baseline"}`, () => {
    for (const explicit of [false, true]) {
      it(`preserves source policy and runtime ceilings with explicit servers ${explicit}`, async () => {
        let executions = 0;
        const raw: RemoteToolSource = {
          id: VERYFRONT_API_MCP_SOURCE_ID,
          listTools: () =>
            Promise.resolve([
              { name: "allowed", description: "Allowed tool", parameters: { type: "object" } },
              { name: "blocked", description: "Blocked tool", parameters: { type: "object" } },
            ]),
          executeTool: () => {
            executions++;
            return Promise.resolve({ ok: true });
          },
        };
        const config = {
          system: "Use the selected remote tools.",
          ...(explicit
            ? {
              mcpServers: [{ kind: "veryfront-api" as const, toolPolicy: { allow: ["allowed"] } }],
            }
            : {}),
          __vfRemoteToolSources: [raw],
        } satisfies RuntimeRemoteToolConfig & Parameters<typeof getRuntimeRemoteToolSources>[0];
        const apply = Reflect.apply;
        const descriptor = Object.getOwnPropertyDescriptor;
        const defineProperty = Object.defineProperty;
        const originals = ["map", "filter", "some", Symbol.iterator].map((key) => ({
          key,
          descriptor: descriptor(Array.prototype, key)!,
        }));
        let observations = 0;
        let selected, constrained, bound, definitions, result;
        try {
          if (hooks) {
            for (let index = 0; index < originals.length; index++) {
              const original = originals[index]!;
              defineProperty(Array.prototype, original.key, {
                ...original.descriptor,
                value: function (this: unknown[], ...args: unknown[]) {
                  for (let index = 0; index < this.length; index++) {
                    const value = descriptor(this, index)?.value;
                    if (
                      value && typeof value === "object" &&
                      descriptor(value, "id")?.value === raw.id &&
                      typeof descriptor(value, "executeTool")?.value === "function"
                    ) observations++;
                  }
                  return apply(original.descriptor.value, this, args);
                },
              });
            }
          }
          selected = getRuntimeRemoteToolSources(config)!;
          constrained = constrainRuntimeRemoteToolSources(selected, ["allowed"])!;
          bound = bindRuntimeRemoteToolSourcesToCredentialOwner(constrained, {
            agentId: "synthetic-agent",
          })!;
          definitions = await getAvailableTools({ allowed: true }, {
            includeIntegrationTools: false,
            remoteToolSources: bound,
            allowedRemoteToolNames: ["allowed"],
          });
          result = await executeConfiguredTool(
            "allowed",
            {},
            { allowed: true },
            undefined,
            ["allowed"],
            bound,
          );
        } finally {
          for (let index = 0; index < originals.length; index++) {
            const original = originals[index]!;
            defineProperty(Array.prototype, original.key, original.descriptor);
          }
        }
        assertEquals(observations, 0);
        assertEquals(definitions?.map((definition) => definition.name), ["allowed"]);
        assertEquals(result, { ok: true });
        if (explicit) {
          assertThrows(() => selected![0]!.executeTool("blocked", {}), Error, "not allowed");
        }
        assertThrows(() => bound![0]!.executeTool("blocked", {}), Error, "not allowed");
        await assertRejects(
          () => executeConfiguredTool("allowed", {}, { allowed: true }, undefined, [], selected),
          Error,
          "not allowed",
        );
        assertEquals(executions, 1);
      });
    }
  });
}

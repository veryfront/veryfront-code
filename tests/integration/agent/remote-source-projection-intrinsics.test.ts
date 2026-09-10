import "#veryfront/schemas/_test-setup.ts";
import {
  bindRuntimeRemoteToolSourcesToCredentialOwner,
  constrainRuntimeRemoteToolSources,
  getRuntimeRemoteToolSources,
  type RuntimeRemoteToolConfig,
  VERYFRONT_API_MCP_SOURCE_ID,
} from "#veryfront/agent/runtime/mcp-server-tool-sources.ts";
import type { AgentConfig } from "#veryfront/agent/types.ts";
import type { RemoteToolSource } from "#veryfront/tool";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

for (const explicitPolicy of [false, true]) {
  for (const hook of [undefined, "map", "filter", "some", Symbol.iterator] as const) {
    describe(`private injected remote sources ${explicitPolicy ? "explicit" : "runtime"} ${String(hook ?? "baseline")}`, () => {
      it("keeps raw execution capabilities private while preserving the selected policy", async () => {
        const calls: string[] = [];
        const source: RemoteToolSource = {
          id: VERYFRONT_API_MCP_SOURCE_ID,
          listTools: async () => [],
          executeTool: async (name) => {
            calls.push(name);
            return { success: true, data: "synthetic-result" };
          },
        };
        const config: AgentConfig & RuntimeRemoteToolConfig = {
          id: "private-remote-agent",
          system: "Synthetic remote tool test",
          tools: true,
          ...(explicitPolicy
            ? { mcpServers: [{ kind: "veryfront-api", toolPolicy: { allow: ["allowed"] } }] }
            : {}),
          __vfRemoteToolSources: [source],
        };
        const apply = Reflect.apply;
        const defineProperty = Object.defineProperty;
        const descriptor = hook === undefined
          ? undefined
          : Object.getOwnPropertyDescriptor(Array.prototype, hook)!;
        let leaked: RemoteToolSource | undefined;
        let selected: RemoteToolSource[] | undefined;
        try {
          if (hook !== undefined) {
            defineProperty(Array.prototype, hook, {
              ...descriptor,
              value: function (this: unknown[], ...args: unknown[]) {
                for (let i = 0; i < this.length; i++) {
                  if (this[i] === source) leaked = source;
                }
                return apply(descriptor!.value, this, args);
              },
            });
          }
          selected = getRuntimeRemoteToolSources(config);
          selected = bindRuntimeRemoteToolSourcesToCredentialOwner(selected, {
            agentId: "private-remote-agent",
          });
          selected = constrainRuntimeRemoteToolSources(selected, ["allowed"]);
        } finally {
          if (hook !== undefined) defineProperty(Array.prototype, hook, descriptor!);
        }
        assertEquals(selected?.length, 1);
        await selected![0]!.executeTool("allowed", {});
        await assertRejects(async () => await selected![0]!.executeTool("denied", {}));
        if (leaked) await leaked.executeTool("denied", {});
        assertEquals(calls, ["allowed"]);
        assertEquals(leaked, undefined);
      });
    });
  }
}

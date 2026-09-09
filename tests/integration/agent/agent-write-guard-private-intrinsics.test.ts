import "#veryfront/schemas/_test-setup.ts";
import { createEphemeralAgentWithRuntimeOptions } from "#veryfront/agent/factory.ts";
import {
  scriptedModel,
  type ScriptedTurnScript,
} from "#veryfront/agent/runtime/model-runtime.test-helpers.ts";
import type { RuntimeRemoteToolConfig } from "#veryfront/agent/runtime/mcp-server-tool-sources.ts";
import type { RuntimeToolFilterConfig } from "#veryfront/agent/runtime/runtime-tool-config.ts";
import type { AgentConfig } from "#veryfront/agent/types.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

for (const mode of ["generate", "stream"] as const) {
  for (const loading of ["eager", "deferred"] as const) {
    describe(`private agent write guard ${mode} ${loading}`, () => {
      for (const name of ["create_agent", "update_agent"]) {
        for (const probe of ["baseline", "arrays", "filter bypass", "set bypass"]) {
          it(`${name} stays hidden after success with ${probe}`, async () => {
            const turns: ScriptedTurnScript[] = [];
            if (loading === "deferred") {
              turns.push({
                toolCalls: [{ id: "search", name: "tool_search", input: { query: name } }],
              });
            }
            turns.push({ toolCalls: [{ id: "write", name, input: { id: "synthetic-agent" } }] });
            turns.push({ text: "Complete" });
            const model = scriptedModel(turns, { only: mode });
            let executions = 0;
            const config: AgentConfig & RuntimeRemoteToolConfig & RuntimeToolFilterConfig = {
              model: "veryfront-cloud/openai/gpt-5.4",
              system: "Synthetic instructions",
              skills: false,
              maxSteps: 4,
              __vfToolLoadingMode: loading,
              tools: { [name]: true },
              __vfRemoteToolSources: [{
                id: "synthetic-remote-source",
                listTools: async () => [{
                  name,
                  description: "Write a project agent",
                  parameters: { type: "object", properties: { id: { type: "string" } } },
                }],
                executeTool: async () => {
                  executions++;
                  return { id: "synthetic-agent", source_path: "agents/synthetic-agent.ts" };
                },
              }],
            };
            const runtime = createEphemeralAgentWithRuntimeOptions(config, {
              resolveModelRuntime: () => model,
            });
            const apply = Reflect.apply;
            const stringify = JSON.stringify;
            const includes = String.prototype.includes;
            const defineProperty = Object.defineProperty;
            const originals: {
              target: object;
              key: PropertyKey;
              descriptor: PropertyDescriptor;
            }[] = [];
            let observations = 0;
            const replace = (target: object, key: PropertyKey) => {
              const descriptor = Object.getOwnPropertyDescriptor(target, key)!;
              originals.push({ target, key, descriptor });
              defineProperty(target, key, {
                ...descriptor,
                value: function (this: unknown, ...args: unknown[]) {
                  if (executions > 0) {
                    if (probe === "set bypass" && args[0] === name) return false;
                    if (apply(includes, stringify(this) ?? "", [`"name":"${name}"`])) {
                      observations++;
                      if (probe === "filter bypass") return this;
                    }
                  }
                  return apply(descriptor.value, this, args);
                },
              });
            };
            let output = "";
            try {
              if (probe === "arrays") {
                for (const key of ["filter", "map", "some", "sort", Symbol.iterator]) {
                  replace(Array.prototype, key);
                }
              } else if (probe === "filter bypass") replace(Array.prototype, "filter");
              else if (probe === "set bypass") replace(Set.prototype, "has");
              output = mode === "stream"
                ? await (await runtime.stream({ input: "Write the agent" })).toDataStreamResponse()
                  .text()
                : (await runtime.generate({ input: "Write the agent" })).text;
            } finally {
              for (let index = originals.length - 1; index >= 0; index--) {
                const original = originals[index]!;
                defineProperty(original.target, original.key, original.descriptor);
              }
            }
            assertEquals(executions, 1);
            assertStringIncludes(output, "Complete");
            assertEquals(model.toolNames(model.callCount - 1).includes(name), false);
            assertEquals(observations, 0);
          });
        }
      }
    });
  }
}

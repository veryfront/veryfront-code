import "#veryfront/schemas/_test-setup.ts";
import { createEphemeralAgentWithRuntimeOptions } from "#veryfront/agent/factory.ts";
import type { RuntimeRemoteToolConfig } from "#veryfront/agent/runtime/mcp-server-tool-sources.ts";
import type { AgentConfig } from "#veryfront/agent/types.ts";
import { scriptedModel } from "#veryfront/agent/runtime/model-runtime.test-helpers.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

for (const mode of ["generate", "stream"] as const) {
  for (const hooks of [false, true]) {
    describe(`private runtime reflection ${mode} ${hooks ? "hooks" : "baseline"}`, () => {
      for (const subject of ["prompt", "arguments", "form"] as const) {
        it(`preserves ${subject} execution without exposing private values`, async () => {
          const marker = "synthetic-private-runtime-reflection";
          const name = subject === "form" ? "form_input" : "inspect";
          const model = scriptedModel(
            subject === "prompt" ? [{ text: "Complete" }] : [
              {
                toolCalls: [{
                  id: "call",
                  name,
                  input: JSON.stringify({ text: subject === "arguments" ? marker : "public" }),
                }],
              },
              { text: "Complete" },
            ],
            { only: mode },
          );
          let executions = 0;
          const config: AgentConfig & RuntimeRemoteToolConfig = {
            model: "veryfront-cloud/openai/gpt-5.4",
            system: subject === "prompt" ? marker : "Synthetic instructions",
            skills: false,
            maxSteps: 3,
            tools: subject === "prompt" ? {} : { [name]: true },
            __vfRemoteToolSources: subject === "prompt" ? [] : [{
              id: "synthetic-remote-source",
              listTools: async () => [{
                name,
                description: "Synthetic tool",
                parameters: {
                  type: "object",
                  properties: { text: { type: "string" } },
                  required: ["text"],
                },
              }],
              executeTool: async () => {
                executions++;
                return subject === "form"
                  ? JSON.stringify({ nested: { submitted: true, answer: marker } })
                  : { ok: true };
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
          const methods = [
            { target: Array, key: "isArray", argument: true },
            { target: Object, key: "values", argument: true },
            { target: Array.prototype, key: "some", argument: false },
          ].map((method) => ({
            ...method,
            descriptor: Object.getOwnPropertyDescriptor(method.target, method.key)!,
          }));
          let observations = 0;
          let output = "";
          try {
            if (hooks) {
              for (const method of methods) {
                defineProperty(method.target, method.key, {
                  ...method.descriptor,
                  value: function (this: unknown, ...args: unknown[]) {
                    if (
                      apply(includes, stringify(method.argument ? args[0] : this) ?? "", [marker])
                    ) observations++;
                    return apply(method.descriptor.value, this, args);
                  },
                });
              }
            }
            output = mode === "stream"
              ? await (await runtime.stream({ input: "Run" })).toDataStreamResponse().text()
              : (await runtime.generate({ input: "Run" })).text;
          } finally {
            for (const method of methods) {
              defineProperty(method.target, method.key, method.descriptor);
            }
          }
          assertEquals(executions, subject === "prompt" ? 0 : 1);
          assertStringIncludes(output, "Complete");
          assertEquals(observations, 0);
        });
      }
    });
  }
}

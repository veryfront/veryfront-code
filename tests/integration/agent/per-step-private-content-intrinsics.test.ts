import "#veryfront/schemas/_test-setup.ts";
import { withIntegrationToolDiscoveryStatus } from "#veryfront/agent/runtime/agent-runtime-step.ts";
import { withAgentRunRuntimeContext } from "#veryfront/agent/runtime/run-runtime-context.ts";
import { hydrateActiveSkillStateFromMessages } from "#veryfront/agent/runtime/skill-policy-enforcement.ts";
import { repairToolCall } from "#veryfront/agent/runtime/repair-tool-call.ts";
import { createInvalidToolInputErrorForTest } from "#veryfront/agent/runtime/runtime-tool-errors.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

for (const probe of ["baseline", "iterator", "flatMap", "strings"]) {
  describe(`private per-step content ${probe}`, () => {
    it("hydrates history, replaces prompt blocks and repairs arguments without shared hooks", async () => {
      const marker = "synthetic-private-per-step-content";
      const instructions = [{
        role: "system" as const,
        content:
          `${marker}\nIntegration tool discovery status:\nold\nEnd integration tool discovery status.\n<runtime_context>old</runtime_context>`,
      }];
      const context = {
        currentTimeUtc: "2026-09-09T00:00:00.000Z",
        currentDateUtc: "2026-09-09",
        runStartedAtUtc: "2026-09-09T00:00:00.000Z",
      };
      const error = createInvalidToolInputErrorForTest({
        cause: new Error("Expected object"),
        toolInput: marker,
        toolName: "web_search",
      });
      const stringify = JSON.stringify;
      const includes = String.prototype.includes;
      const apply = Reflect.apply;
      const defineProperty = Object.defineProperty;
      const originals: { target: object; key: PropertyKey; descriptor: PropertyDescriptor }[] = [];
      let observations = 0;
      const replace = (target: object, key: PropertyKey) => {
        const descriptor = Object.getOwnPropertyDescriptor(target, key)!;
        originals.push({ target, key, descriptor });
        defineProperty(target, key, {
          ...descriptor,
          value: function (this: unknown, ...args: unknown[]) {
            if (apply(includes, stringify(this) ?? "", [marker])) observations++;
            return apply(descriptor.value, this, args);
          },
        });
      };
      let prompts;
      let raw;
      let quoted;
      let state;
      try {
        if (probe === "iterator") replace(Array.prototype, Symbol.iterator);
        if (probe === "flatMap") replace(Array.prototype, "flatMap");
        if (probe === "strings") {
          for (
            const key of [
              "trim",
              "trimStart",
              "trimEnd",
              "indexOf",
              "slice",
              "search",
              "match",
              "replaceAll",
            ]
          ) replace(String.prototype, key);
        }
        state = hydrateActiveSkillStateFromMessages([{
          id: "user",
          role: "user",
          parts: [{ type: "text", text: marker }],
        }]);
        prompts = withAgentRunRuntimeContext(
          withIntegrationToolDiscoveryStatus(instructions, undefined),
          context,
        );
        const repair = (input: string) =>
          repairToolCall({
            error,
            inputSchema: () => Promise.resolve({ type: "object" }),
            messages: [],
            system: undefined,
            tools: {},
            toolCall: {
              type: "tool-call",
              toolCallId: "call",
              toolName: "web_search",
              providerExecuted: true,
              input,
            },
          });
        raw = await repair(` ${marker} `);
        quoted = await repair(stringify(` ${marker} `));
      } finally {
        for (let index = originals.length - 1; index >= 0; index--) {
          const original = originals[index]!;
          defineProperty(original.target, original.key, original.descriptor);
        }
      }
      assertEquals(state?.activeSkillId, undefined);
      assertEquals(prompts?.[0]?.content, marker);
      assertStringIncludes(prompts?.[1]?.content ?? "", "2026-09-09");
      assertEquals(raw?.input, stringify({ query: marker }));
      assertEquals(quoted?.input, stringify({ query: marker }));
      assertEquals(observations, 0);
    });
  });
}

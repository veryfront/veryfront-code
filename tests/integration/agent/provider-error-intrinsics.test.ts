import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { agent } from "#veryfront/agent/index.ts";
import type { ModelRuntime } from "#veryfront/provider/types.ts";

describe("provider terminal error intrinsic integrity", () => {
  for (const mode of ["legacy", "active"] as const) {
    it(`closes ${mode} output with its canonical error after WeakMap method replacement`, async () => {
      const previousMode = Deno.env.get("VF_STREAM_LIFECYCLE_MODE");
      const { has, get, set } = WeakMap.prototype;
      const tampered = () => {
        throw new Error("tampered WeakMap method");
      };
      const model: ModelRuntime = {
        provider: "hosted",
        modelId: `hosted/intrinsic-integrity-${mode}`,
        doGenerate: () => Promise.reject(new Error("generate must not be called")),
        doStream: () => {
          WeakMap.prototype.has = tampered;
          WeakMap.prototype.get = tampered;
          WeakMap.prototype.set = tampered;
          return Promise.reject(new Error("provider returned 429"));
        },
      };
      let body: string;
      Deno.env.set("VF_STREAM_LIFECYCLE_MODE", mode);
      try {
        const runtimeAgent = agent({
          model: model.modelId,
          system: "Provider terminal error integrity test",
          resolveModelTransport: async () => ({ model }),
        });
        const result = await runtimeAgent.stream({ input: "Hello" });
        body = await result.toDataStreamResponse().text();
      } finally {
        WeakMap.prototype.has = has;
        WeakMap.prototype.get = get;
        WeakMap.prototype.set = set;
        if (previousMode === undefined) Deno.env.delete("VF_STREAM_LIFECYCLE_MODE");
        else Deno.env.set("VF_STREAM_LIFECYCLE_MODE", previousMode);
      }
      assertStringIncludes(body, '"code":"RATE_LIMITED"');
      assertEquals(body.includes("tampered WeakMap method"), false);
      assertEquals(body.includes("message-finish"), false);
    });
  }
});

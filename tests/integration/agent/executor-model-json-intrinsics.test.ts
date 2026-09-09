import { executorModelJson } from "#veryfront/agent/hosted/executor-model-schema.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

for (const probe of ["baseline", "reflection", "collections"]) {
  describe(`private managed model JSON ${probe}`, () => {
    it("copies complete model options without exposing them through shared operations", () => {
      const marker = "synthetic-private-managed-options";
      const input = {
        prompt: [{ role: "user", content: [{ type: "text", text: marker }] }],
        optional: undefined,
      };
      const stringify = JSON.stringify;
      const includes = String.prototype.includes;
      const apply = Reflect.apply;
      const getDescriptor = Object.getOwnPropertyDescriptor;
      const defineProperty = Object.defineProperty;
      const originals: { target: object; key: PropertyKey; descriptor: PropertyDescriptor }[] = [];
      let observations = 0;
      const replace = (target: object, key: PropertyKey, argument: boolean) => {
        const descriptor = getDescriptor(target, key)!;
        originals.push({ target, key, descriptor });
        defineProperty(target, key, {
          ...descriptor,
          value: function (this: unknown, ...args: unknown[]) {
            if (
              apply(includes, stringify(argument ? args[0] : this) ?? "", [marker])
            ) observations++;
            return apply(descriptor.value, this, args);
          },
        });
      };
      let output;
      try {
        if (probe === "reflection") {
          replace(Reflect, "ownKeys", true);
          replace(Object, "getOwnPropertyDescriptor", true);
          replace(Object, "getPrototypeOf", true);
          replace(Object, "defineProperty", true);
        }
        if (probe === "collections") {
          replace(Array, "isArray", true);
          replace(Set.prototype, "has", true);
          replace(Set.prototype, "add", true);
          replace(Set.prototype, "delete", true);
        }
        output = executorModelJson(input);
      } finally {
        for (let index = originals.length - 1; index >= 0; index--) {
          const original = originals[index]!;
          defineProperty(original.target, original.key, original.descriptor);
        }
      }
      assertEquals(output, { prompt: input.prompt });
      assertEquals(observations, 0);
    });
  });
}

import "./_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { defineSchema } from "./define.ts";
import { lazySchema } from "./lazy.ts";

describe("lazySchema", () => {
  it("reflects non-configurable adapter metadata without violating proxy invariants", () => {
    let materializations = 0;
    const getConcreteSchema = defineSchema((v) => v.string());
    const schema = lazySchema(() => {
      materializations += 1;
      const concreteSchema = getConcreteSchema();
      Object.defineProperty(concreteSchema, "adapterMetadata", {
        configurable: false,
        enumerable: true,
        value: "test-adapter",
      });
      return concreteSchema;
    });

    assertEquals(materializations, 0);
    assertEquals(
      Object.getOwnPropertyDescriptor(schema, "adapterMetadata")?.value,
      "test-adapter",
    );
    assertEquals(materializations, 1);
  });

  it("can be frozen without breaking reflection or validation", () => {
    const schema = lazySchema(defineSchema((v) => v.string().min(1)));

    Object.freeze(schema);

    assertEquals(Object.isFrozen(schema), true);
    assertEquals(schema.parse("Veryfront"), "Veryfront");
  });
});

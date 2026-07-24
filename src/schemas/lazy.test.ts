import "./_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { Schema } from "#veryfront/extensions/schema/index.ts";
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

  it("prefers concrete own metadata over inherited facade properties", () => {
    const getConcreteSchema = defineSchema((v) => v.string());
    const concreteSchema = getConcreteSchema();
    Object.defineProperties(concreteSchema, {
      toString: {
        configurable: true,
        enumerable: true,
        value: "adapter-to-string",
      },
      receiverAwareMetadata: {
        configurable: true,
        enumerable: true,
        get() {
          return this === concreteSchema ? "concrete" : "wrong receiver";
        },
      },
    });
    const schema = lazySchema(() => concreteSchema);
    const metadata = schema as unknown as Record<string, unknown>;

    Object.freeze(schema);

    assertEquals(Reflect.get(metadata, "toString"), "adapter-to-string");
    assertEquals(metadata.receiverAwareMetadata, "concrete");
  });

  it("rejects malformed getter results at materialization", () => {
    const schema = lazySchema(() => null as never);

    assertThrows(
      () => schema.parse("value"),
      TypeError,
      "lazySchema getter must return a Schema",
    );
  });

  it("fails clearly when its getter re-enters the facade", () => {
    const concreteSchema = defineSchema((v) => v.string())();
    const holder = {} as { schema: Schema<string> };
    holder.schema = lazySchema(() => {
      holder.schema.parse("value");
      return concreteSchema;
    });

    assertThrows(
      () => holder.schema.parse("value"),
      Error,
      "lazySchema getter recursively invoked its own facade",
    );
  });
});

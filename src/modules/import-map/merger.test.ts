import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { mergeImportMaps } from "./merger.ts";

describe("modules/import-map/merger", () => {
  describe("mergeImportMaps", () => {
    it("should merge imports from multiple maps", () => {
      const result = mergeImportMaps(
        { imports: { react: "https://esm.sh/react@18" } },
        { imports: { lodash: "https://esm.sh/lodash" } },
      );

      assertEquals(result.imports?.react, "https://esm.sh/react@18");
      assertEquals(result.imports?.lodash, "https://esm.sh/lodash");
    });

    it("should override earlier imports with later ones", () => {
      const result = mergeImportMaps(
        { imports: { react: "https://esm.sh/react@17" } },
        { imports: { react: "https://esm.sh/react@18" } },
      );

      assertEquals(result.imports?.react, "https://esm.sh/react@18");
    });

    it("should merge scopes", () => {
      const result = mergeImportMaps(
        { imports: {}, scopes: { "/app/": { lodash: "v1" } } },
        { imports: {}, scopes: { "/app/": { react: "v2" } } },
      );

      assertEquals(result.scopes?.["/app/"]?.lodash, "v1");
      assertEquals(result.scopes?.["/app/"]?.react, "v2");
    });

    it("should handle empty maps", () => {
      const result = mergeImportMaps({ imports: {} }, { imports: {} });
      assertEquals(Object.keys(result.imports ?? {}).length, 0);
    });

    it("should handle maps without scopes", () => {
      const result = mergeImportMaps(
        { imports: { a: "b" } },
        { imports: { c: "d" } },
      );

      assertEquals(Object.keys(result.scopes ?? {}).length, 0);
    });

    it("should handle single map", () => {
      const result = mergeImportMaps({ imports: { a: "b" } });
      assertEquals(result.imports?.a, "b");
    });

    it("treats prototype-shaped keys as inert own import-map data", () => {
      const objectConstructor = Object as unknown as Record<string, unknown>;
      const objectPrototype = Object.prototype as Record<string, unknown>;
      const constructorDescriptor = Object.getOwnPropertyDescriptor(
        objectConstructor,
        "vfConstructorPolluted",
      );
      const prototypeDescriptor = Object.getOwnPropertyDescriptor(
        objectPrototype,
        "vfPolluted",
      );
      const input = JSON.parse(`{
        "imports": {
          "__proto__": "proto-import",
          "constructor": "constructor-import",
          "prototype": "prototype-import"
        },
        "scopes": {
          "__proto__": { "vfPolluted": "yes" },
          "constructor": { "vfConstructorPolluted": "yes" },
          "prototype": {
            "__proto__": "inner-proto-import",
            "constructor": "inner-constructor-import"
          }
        }
      }`) as never;

      try {
        const result = mergeImportMaps(input);
        const imports = result.imports as Record<string, string>;
        const scopes = result.scopes as Record<string, Record<string, string>>;

        assertEquals(Object.getPrototypeOf(imports), null);
        assertEquals(Object.getPrototypeOf(scopes), null);
        assertEquals(Object.hasOwn(imports, "__proto__"), true);
        assertEquals(Object.hasOwn(imports, "constructor"), true);
        assertEquals(Object.hasOwn(scopes, "__proto__"), true);
        assertEquals(Object.hasOwn(scopes, "constructor"), true);
        assertEquals(Object.hasOwn(scopes, "prototype"), true);
        assertEquals(Object.getPrototypeOf(scopes["__proto__"]), null);
        assertEquals(Object.getPrototypeOf(scopes.constructor), null);
        assertEquals(Object.getPrototypeOf(scopes.prototype), null);
        assertEquals(scopes["__proto__"]?.vfPolluted, "yes");
        assertEquals(scopes["constructor"]?.vfConstructorPolluted, "yes");
        assertEquals(scopes.prototype?.["__proto__"], "inner-proto-import");
        assertEquals(objectPrototype.vfPolluted, prototypeDescriptor?.value);
        assertEquals(
          objectConstructor.vfConstructorPolluted,
          constructorDescriptor?.value,
        );
      } finally {
        if (prototypeDescriptor) {
          Object.defineProperty(objectPrototype, "vfPolluted", prototypeDescriptor);
        } else {
          delete objectPrototype.vfPolluted;
        }
        if (constructorDescriptor) {
          Object.defineProperty(
            objectConstructor,
            "vfConstructorPolluted",
            constructorDescriptor,
          );
        } else {
          delete objectConstructor.vfConstructorPolluted;
        }
      }
    });
  });
});

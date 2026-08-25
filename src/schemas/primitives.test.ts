import "./_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  getAbsolutePathSchema,
  getFilePathSchema,
  getHexColorSchema,
  getJsonValueSchema,
  getNonEmptyStringSchema,
  getNonNegativeIntSchema,
  getPortNumberSchema,
  getPositiveIntSchema,
  getSemverSchema,
  getTimestampSchema,
} from "./index.ts";
import { snapshotBoundedJsonValue } from "./json-value.ts";
import { MAX_PATH_LENGTH_CHARS } from "../utils/constants/index.ts";

function assertParseSuccess(result: { success: boolean }, message?: string): void {
  assertEquals(result.success, true, message);
}

function assertParseFailure(result: { success: boolean }, message?: string): void {
  assertEquals(result.success, false, message);
}

describe("primitive schemas", () => {
  describe("nonEmptyString", () => {
    it("accepts non-empty strings", () => {
      assertParseSuccess(getNonEmptyStringSchema().safeParse("value"));
    });

    it("rejects empty strings", () => {
      assertParseFailure(getNonEmptyStringSchema().safeParse(""));
    });
  });

  describe("positiveInt", () => {
    it("accepts positive integers", () => {
      assertParseSuccess(getPositiveIntSchema().safeParse(1));
    });

    it("rejects zero and decimals", () => {
      assertParseFailure(getPositiveIntSchema().safeParse(0));
      assertParseFailure(getPositiveIntSchema().safeParse(1.5));
    });
  });

  describe("nonNegativeInt", () => {
    it("accepts zero", () => {
      assertParseSuccess(getNonNegativeIntSchema().safeParse(0));
    });

    it("rejects negative numbers and decimals", () => {
      assertParseFailure(getNonNegativeIntSchema().safeParse(-1));
      assertParseFailure(getNonNegativeIntSchema().safeParse(0.5));
    });
  });

  describe("portNumber", () => {
    it("accepts boundary port numbers", () => {
      assertParseSuccess(getPortNumberSchema().safeParse(1));
      assertParseSuccess(getPortNumberSchema().safeParse(65535));
    });

    it("rejects out-of-range values", () => {
      assertParseFailure(getPortNumberSchema().safeParse(0));
      assertParseFailure(getPortNumberSchema().safeParse(65536));
    });
  });

  describe("timestamp", () => {
    it("accepts ISO datetime strings", () => {
      assertParseSuccess(getTimestampSchema().safeParse("2024-01-01T00:00:00Z"));
    });

    it("rejects non-datetime strings", () => {
      assertParseFailure(getTimestampSchema().safeParse("not-a-timestamp"));
    });
  });

  describe("jsonValue", () => {
    it("accepts nested JSON-compatible values", () => {
      assertParseSuccess(
        getJsonValueSchema().safeParse({
          name: "test",
          count: 2,
          enabled: true,
          items: [null, { nested: ["value"] }],
        }),
      );
    });

    it("rejects undefined values", () => {
      assertParseFailure(getJsonValueSchema().safeParse({ invalid: undefined }));
    });

    it("rejects cyclic values without throwing", () => {
      const cyclic: Record<string, unknown> = {};
      cyclic.self = cyclic;

      assertParseFailure(getJsonValueSchema().safeParse(cyclic));
    });

    it("reports the narrowest safely observed rejection path", () => {
      const cyclic: Record<string, unknown> = {};
      cyclic.self = cyclic;

      assertEquals(snapshotBoundedJsonValue({ nested: { invalid: undefined } }), {
        success: false,
        path: ["nested", "invalid"],
      });
      assertEquals(snapshotBoundedJsonValue({ nested: cyclic }), {
        success: false,
        path: ["nested", "self"],
      });
    });

    it("uses captured snapshot primordials after module initialization", () => {
      const originalArrayIsArray = Array.isArray;
      const originalNumberIsFinite = Number.isFinite;
      const originalNumberIsSafeInteger = Number.isSafeInteger;
      const originalStringify = JSON.stringify;
      const originalApply = Reflect.apply;
      const originalGetOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor;
      const originalGetPrototypeOf = Reflect.getPrototypeOf;
      const originalOwnKeys = Reflect.ownKeys;
      const originalDefineProperty = Object.defineProperty;
      const originalDeleteProperty = Reflect.deleteProperty;
      const originalEncode = TextEncoder.prototype.encode;
      const originalSetAdd = Set.prototype.add;
      const originalSetDelete = Set.prototype.delete;
      const originalSetHas = Set.prototype.has;
      const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
      const originalByteLengthDescriptor = Object.getOwnPropertyDescriptor(
        typedArrayPrototype,
        "byteLength",
      );
      const originalArrayZeroDescriptor = Object.getOwnPropertyDescriptor(
        Array.prototype,
        "0",
      );
      let poisonCalls = 0;
      const poison = (): never => {
        poisonCalls += 1;
        throw new Error("ambient snapshot primordial must not run");
      };
      let result: ReturnType<typeof snapshotBoundedJsonValue> | undefined;

      try {
        originalDefineProperty(Array.prototype, "0", {
          configurable: true,
          set(this: unknown[], next: unknown) {
            if (next === "schema-sentinel") {
              poisonCalls += 1;
              return;
            }
            originalDefineProperty(this, "0", {
              value: next,
              enumerable: true,
              configurable: true,
              writable: true,
            });
          },
        });
        originalDefineProperty(typedArrayPrototype, "byteLength", {
          ...originalByteLengthDescriptor,
          get: poison,
        });
        Array.isArray = poison as unknown as typeof Array.isArray;
        Number.isFinite = poison as typeof Number.isFinite;
        Number.isSafeInteger = poison as typeof Number.isSafeInteger;
        JSON.stringify = poison as typeof JSON.stringify;
        Reflect.apply = poison as typeof Reflect.apply;
        Reflect.getOwnPropertyDescriptor = poison as typeof Reflect.getOwnPropertyDescriptor;
        Reflect.getPrototypeOf = poison as typeof Reflect.getPrototypeOf;
        Reflect.ownKeys = poison as typeof Reflect.ownKeys;
        Object.defineProperty = poison as typeof Object.defineProperty;
        TextEncoder.prototype.encode = poison as typeof TextEncoder.prototype.encode;
        Set.prototype.add = poison as typeof Set.prototype.add;
        Set.prototype.delete = poison as typeof Set.prototype.delete;
        Set.prototype.has = poison as typeof Set.prototype.has;

        result = snapshotBoundedJsonValue({
          nested: ["schema-sentinel", { ready: true }],
        });
      } finally {
        Array.isArray = originalArrayIsArray;
        Number.isFinite = originalNumberIsFinite;
        Number.isSafeInteger = originalNumberIsSafeInteger;
        JSON.stringify = originalStringify;
        Reflect.apply = originalApply;
        Reflect.getOwnPropertyDescriptor = originalGetOwnPropertyDescriptor;
        Reflect.getPrototypeOf = originalGetPrototypeOf;
        Reflect.ownKeys = originalOwnKeys;
        Object.defineProperty = originalDefineProperty;
        TextEncoder.prototype.encode = originalEncode;
        Set.prototype.add = originalSetAdd;
        Set.prototype.delete = originalSetDelete;
        Set.prototype.has = originalSetHas;
        if (originalArrayZeroDescriptor) {
          originalDefineProperty(Array.prototype, "0", originalArrayZeroDescriptor);
        } else {
          originalDeleteProperty(Array.prototype, "0");
        }
        if (originalByteLengthDescriptor) {
          originalDefineProperty(
            typedArrayPrototype,
            "byteLength",
            originalByteLengthDescriptor,
          );
        }
      }

      assertEquals(poisonCalls, 0);
      assertEquals(result, {
        success: true,
        value: { nested: ["schema-sentinel", { ready: true }] },
      });
    });

    it("rejects values deeper than the validation limit without throwing", () => {
      let value: unknown = null;
      for (let depth = 0; depth < 256; depth++) value = [value];

      assertParseFailure(getJsonValueSchema().safeParse(value));
    });

    it("accepts values nested to exactly the validation limit", () => {
      let value: unknown = null;
      for (let depth = 0; depth < 128; depth++) value = [value];

      assertParseSuccess(
        getJsonValueSchema().safeParse(value),
        "a value nested to exactly the documented depth limit must be accepted",
      );
    });

    it("rejects oversized strings", () => {
      assertParseFailure(getJsonValueSchema().safeParse("x".repeat(1_048_577)));
      assertParseSuccess(
        getJsonValueSchema().safeParse("x".repeat(1_048_576)),
        "a string at exactly the documented string-byte limit must be accepted",
      );
    });

    it("bounds the node count of a payload", () => {
      // The container itself counts as one node, so an array of N elements
      // walks N + 1 nodes against the 100_000-node limit.
      assertEquals(
        snapshotBoundedJsonValue(new Array(99_999).fill(0)).success,
        true,
        "an array at exactly the documented node limit must be accepted",
      );
      assertEquals(
        snapshotBoundedJsonValue(new Array(100_000).fill(0)).success,
        false,
        "an array above the documented node limit must be rejected",
      );
      assertParseFailure(
        getJsonValueSchema().safeParse(new Array(100_000).fill(0)),
        "an oversized node count must fail validation rather than throw",
      );
    });

    it("bounds the serialized size of a payload", () => {
      const megabyte = "a".repeat(1024 * 1024);

      assertEquals(
        snapshotBoundedJsonValue([megabyte, megabyte, megabyte]).success,
        true,
        "a payload under the documented serialized-byte limit must be accepted",
      );
      assertEquals(
        snapshotBoundedJsonValue([megabyte, megabyte, megabyte, megabyte, megabyte])
          .success,
        false,
        "a payload above the documented serialized-byte limit must be rejected",
      );
    });

    it("bounds the byte length of an object key", () => {
      const maximumKey = "k".repeat(16 * 1024);
      const oversizedKey = `${maximumKey}k`;

      assertEquals(
        snapshotBoundedJsonValue({ [maximumKey]: 1 }).success,
        true,
        "a key at exactly the documented key-byte limit must be accepted",
      );
      assertEquals(
        snapshotBoundedJsonValue({ [oversizedKey]: 1 }),
        { success: false, path: [oversizedKey] },
        "a key above the documented key-byte limit must be rejected at that key",
      );
    });

    it("rejects accessors without invoking them", () => {
      let reads = 0;
      const value: Record<string, unknown> = {};
      Object.defineProperty(value, "field", {
        enumerable: true,
        get() {
          reads += 1;
          return "value";
        },
      });

      assertParseFailure(getJsonValueSchema().safeParse(value));
      assertEquals(reads, 0);
    });

    it("consumes one data-only snapshot of a stateful Proxy", () => {
      let descriptorReads = 0;
      let valueReads = 0;
      const target = { field: "target" };
      const value = new Proxy(target, {
        getOwnPropertyDescriptor(_target, property) {
          if (property !== "field") return undefined;
          descriptorReads += 1;
          return {
            configurable: true,
            enumerable: true,
            writable: true,
            value: "snapshot",
          };
        },
        get(_target, property, receiver) {
          if (property === "field") {
            valueReads += 1;
            return () => "not-json";
          }
          return Reflect.get(_target, property, receiver);
        },
      });

      const result = getJsonValueSchema().safeParse(value);

      assertEquals(result.success, true);
      if (!result.success) return;
      assertEquals(result.data, { field: "snapshot" });
      assertEquals(result.data === value, false);
      assertEquals(descriptorReads, 1);
      assertEquals(valueReads, 0);
    });

    it("rejects objects with custom prototypes or symbol keys", () => {
      const inherited = Object.assign(Object.create({ inherited: true }), { own: true });
      const symbolKeyed = { value: true, [Symbol("hidden")]: true };

      assertParseFailure(getJsonValueSchema().safeParse(inherited));
      assertParseFailure(getJsonValueSchema().safeParse(symbolKeyed));
    });

    it("preserves __proto__ as data without changing the output prototype", () => {
      const value: Record<string, unknown> = {};
      Object.defineProperty(value, "__proto__", {
        configurable: true,
        enumerable: true,
        writable: true,
        value: { polluted: true },
      });

      const result = getJsonValueSchema().safeParse(value);

      assertEquals(result.success, true);
      if (!result.success) return;
      assertEquals(Object.hasOwn(result.data as object, "__proto__"), true);
      assertEquals((result.data as Record<string, unknown>)["__proto__"], {
        polluted: true,
      });
      assertEquals(Object.getPrototypeOf(result.data as object), Object.prototype);
      assertEquals((result.data as { polluted?: unknown }).polluted, undefined);
    });
  });

  describe("hexColor", () => {
    it("accepts short and long hex colors", () => {
      assertParseSuccess(getHexColorSchema().safeParse("#fff"));
      assertParseSuccess(getHexColorSchema().safeParse("#A1b2C3"));
    });

    it("rejects invalid hex colors", () => {
      assertParseFailure(getHexColorSchema().safeParse("123456"));
      assertParseFailure(getHexColorSchema().safeParse("#abcd"));
    });
  });

  describe("semver", () => {
    it("accepts standard semantic versions", () => {
      assertParseSuccess(getSemverSchema().safeParse("1.2.3"));
      assertParseSuccess(getSemverSchema().safeParse("1.2.3-beta.1+build.5"));
    });

    it("rejects invalid semantic versions", () => {
      assertParseFailure(getSemverSchema().safeParse("1.2"));
      assertParseFailure(getSemverSchema().safeParse("01.2.3"));
    });
  });

  describe("filePath", () => {
    it("accepts non-empty file paths", () => {
      assertParseSuccess(getFilePathSchema().safeParse("src/main.ts"));
      assertParseSuccess(getFilePathSchema().safeParse("/tmp/main.ts"));
    });

    it("rejects empty file paths", () => {
      assertParseFailure(getFilePathSchema().safeParse(""));
    });

    it("rejects file paths containing null bytes", () => {
      assertParseFailure(getFilePathSchema().safeParse("src/main\0.ts"));
    });

    it("rejects file paths exceeding the shared path limit", () => {
      assertParseSuccess(getFilePathSchema().safeParse("a".repeat(MAX_PATH_LENGTH_CHARS)));
      assertParseFailure(getFilePathSchema().safeParse("a".repeat(MAX_PATH_LENGTH_CHARS + 1)));
    });
  });

  describe("absolutePath", () => {
    it("accepts unix and windows absolute paths", () => {
      assertParseSuccess(getAbsolutePathSchema().safeParse("/usr/local/bin"));
      assertParseSuccess(getAbsolutePathSchema().safeParse(String.raw`C:\Projects\veryfront`));
      assertParseSuccess(getAbsolutePathSchema().safeParse("C:/Projects/veryfront"));
      assertParseSuccess(getAbsolutePathSchema().safeParse(String.raw`\Projects\veryfront`));
      assertParseSuccess(
        getAbsolutePathSchema().safeParse(String.raw`\\server\share\veryfront`),
      );
    });

    it("rejects relative paths", () => {
      assertParseFailure(getAbsolutePathSchema().safeParse("relative/path"));
      assertParseFailure(getAbsolutePathSchema().safeParse("C:relative\\path"));
      assertParseFailure(getAbsolutePathSchema().safeParse(String.raw`\\server`));
    });

    it("rejects absolute paths containing null bytes", () => {
      assertParseFailure(getAbsolutePathSchema().safeParse("/tmp/main\0.ts"));
    });

    it("rejects absolute paths exceeding the shared path limit", () => {
      assertParseSuccess(
        getAbsolutePathSchema().safeParse(`/${"a".repeat(MAX_PATH_LENGTH_CHARS - 1)}`),
      );
      assertParseFailure(
        getAbsolutePathSchema().safeParse(`/${"a".repeat(MAX_PATH_LENGTH_CHARS)}`),
      );
    });
  });
});

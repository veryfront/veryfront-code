import "#veryfront/schemas/_test-setup.ts";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { isNode } from "#veryfront/platform/compat/runtime.ts";
import { assertEquals, assertNotEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { computeCodeHash, computeHash, fnv1aHash, shortHash, simpleHash } from "./hash-utils.ts";

const POISONED_DIGEST_SCRIPT = String.raw`
import { computeHash } from "./src/utils/hash-utils.ts";

const lengthDescriptor = Object.getOwnPropertyDescriptor(
  Uint8Array.prototype,
  "length",
);
const byteLengthDescriptor = Object.getOwnPropertyDescriptor(
  Uint8Array.prototype,
  "byteLength",
);

try {
  Object.defineProperty(Uint8Array.prototype, "length", {
    configurable: true,
    get: () => 0,
  });
  Object.defineProperty(Uint8Array.prototype, "byteLength", {
    configurable: true,
    get: () => 0,
  });

  const hash = await computeHash("typed-array-accessor-regression");
  const expected =
    "e6f350a0d3a7ab1460425109d5aef847b5fcda425a8b45af135af8dff19b5154";
  if (hash !== expected) {
    throw new Error("expected " + expected + ", received " + hash);
  }
} finally {
  restoreDescriptor("length", lengthDescriptor);
  restoreDescriptor("byteLength", byteLengthDescriptor);
}

function restoreDescriptor(name, descriptor) {
  if (descriptor) {
    Object.defineProperty(Uint8Array.prototype, name, descriptor);
  } else {
    Reflect.deleteProperty(Uint8Array.prototype, name);
  }
}
`;

describe("hash-utils", () => {
  describe("computeHash", () => {
    it("should compute SHA-256 hash of content", async () => {
      const hash = await computeHash("hello world");
      assertEquals(hash.length, 64);
      assertEquals(/^[0-9a-f]+$/.test(hash), true);
    });

    it("should produce consistent hashes for same input", async () => {
      const input = "test content";
      const hash1 = await computeHash(input);
      const hash2 = await computeHash(input);
      assertEquals(hash1, hash2);
    });

    it("should produce different hashes for different input", async () => {
      const hash1 = await computeHash("content a");
      const hash2 = await computeHash("content b");
      assertNotEquals(hash1, hash2);
    });

    it("should handle empty string", async () => {
      const hash = await computeHash("");
      assertEquals(hash.length, 64);
    });

    it("should handle unicode content", async () => {
      const hash = await computeHash("こんにちは世界");
      assertEquals(hash.length, 64);
    });

    it("keeps typed-array poisoning active through the complete async digest", () => {
      if (!isNode) return;

      const result = spawnSync(
        process.execPath,
        [
          "--import",
          "./tests/node/resolver.mjs",
          "--input-type=module",
          "--eval",
          POISONED_DIGEST_SCRIPT,
        ],
        {
          encoding: "utf8",
          timeout: 10_000,
        },
      );

      assertEquals(result.error, undefined);
      assertEquals(result.signal, null, result.stderr);
      assertEquals(result.status, 0, result.stderr);
    });
  });

  describe("computeCodeHash", () => {
    it("should hash code only", async () => {
      const hash = await computeCodeHash({ code: "const x = 1;" });
      assertEquals(hash.length, 64);
    });

    it("should include css in hash when provided", async () => {
      const bundle = { code: "const x = 1;" };
      const hashWithoutCss = await computeCodeHash(bundle);
      const hashWithCss = await computeCodeHash({
        ...bundle,
        css: ".foo { color: red; }",
      });
      assertNotEquals(hashWithoutCss, hashWithCss);
    });

    it("should include sourceMap in hash when provided", async () => {
      const bundle = { code: "const x = 1;" };
      const hashWithoutMap = await computeCodeHash(bundle);
      const hashWithMap = await computeCodeHash({
        ...bundle,
        sourceMap: "//# sourceMappingURL=...",
      });
      assertNotEquals(hashWithoutMap, hashWithMap);
    });

    it("distinguishes fields at their boundaries", async () => {
      assertNotEquals(
        await computeCodeHash({ code: "c", css: "a" }),
        await computeCodeHash({ code: "c", sourceMap: "a" }),
        "css and sourceMap content must not hash identically",
      );
      assertNotEquals(
        await computeCodeHash({ code: "ab" }),
        await computeCodeHash({ code: "a", css: "b" }),
        "the code/css boundary must be encoded in the hash",
      );
    });

    it("distinguishes lone surrogates from replacement characters in every field", async () => {
      for (const field of ["code", "css", "sourceMap"] as const) {
        const withLoneSurrogate = {
          code: "",
          [field]: "\uD800",
        };
        const withReplacementCharacter = {
          code: "",
          [field]: "\uFFFD",
        };

        assertNotEquals(
          await computeCodeHash(withLoneSurrogate),
          await computeCodeHash(withReplacementCharacter),
          `${field} must preserve raw UTF-16 code-unit identity`,
        );
      }
    });

    it("frames bundle fields without ambient array serialization methods", async () => {
      const originalJoin = Array.prototype.join;
      const originalMap = Array.prototype.map;
      const poison = () => {
        throw new Error("ambient bundle hash framing method must not run");
      };

      let hash: string | undefined;
      try {
        Array.prototype.join = poison as typeof Array.prototype.join;
        Array.prototype.map = poison as typeof Array.prototype.map;
        hash = await computeCodeHash({
          code: "const x = 1;",
          css: ".x { color: red; }",
          sourceMap: "{}",
        });
      } finally {
        Array.prototype.join = originalJoin;
        Array.prototype.map = originalMap;
      }

      assertEquals(hash?.length, 64);
    });

    it("should produce consistent hash for same bundle", async () => {
      const bundle = {
        code: "const x = 1;",
        css: ".foo {}",
        sourceMap: "map",
      };
      const hash1 = await computeCodeHash(bundle);
      const hash2 = await computeCodeHash(bundle);
      assertEquals(hash1, hash2);
    });
  });

  describe("simpleHash", () => {
    it("should produce a number", () => {
      assertEquals(typeof simpleHash("test"), "number");
    });

    it("should produce non-negative numbers", () => {
      for (const input of ["test", "another string", "negative test"]) {
        assertEquals(simpleHash(input) >= 0, true);
      }
    });

    it("should produce consistent hashes", () => {
      const input = "consistent";
      assertEquals(simpleHash(input), simpleHash(input));
    });

    it("should produce different hashes for different strings", () => {
      assertNotEquals(simpleHash("string a"), simpleHash("string b"));
    });

    it("should handle empty string", () => {
      assertEquals(simpleHash(""), 0);
    });
  });

  describe("shortHash", () => {
    it("should return first 8 characters of full hash", async () => {
      const input = "test content";
      const full = await computeHash(input);
      const short = await shortHash(input);
      assertEquals(short.length, 8);
      assertEquals(short, full.slice(0, 8));
    });

    it("should produce consistent short hashes", async () => {
      const input = "hello";
      assertEquals(await shortHash(input), await shortHash(input));
    });

    it("should be different for different content", async () => {
      assertNotEquals(await shortHash("content 1"), await shortHash("content 2"));
    });
  });

  describe("fnv1aHash", () => {
    it("includes every UTF-16 code unit for non-BMP characters", () => {
      assertNotEquals(fnv1aHash("😀"), fnv1aHash("😁"));
    });
  });
});

import "#veryfront/schemas/_test-setup.ts";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { isNode } from "#veryfront/platform/compat/runtime.ts";
import { assertEquals, assertNotEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  cacheNamespaceSegment,
  computeCodeHash,
  computeHash,
  fnv1aHash,
  hashCodeHex,
  shortHash,
  simpleHash,
} from "./hash-utils.ts";

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

  describe("cacheNamespaceSegment", () => {
    it("separates identifiers whose 32-bit hashCodeHex digests collide", () => {
      // These SSR cache namespace keys previously used hashCodeHex, letting
      // two content sources with colliding ids share one cache directory.
      assertEquals(hashCodeHex("preview-58x4ga9b"), hashCodeHex("preview-5icz6rpk"));
      assertNotEquals(
        cacheNamespaceSegment("preview-58x4ga9b"),
        cacheNamespaceSegment("preview-5icz6rpk"),
      );
    });

    it("is deterministic", () => {
      assertEquals(cacheNamespaceSegment("branch-main"), cacheNamespaceSegment("branch-main"));
    });

    it("produces filesystem- and URL-safe segments", () => {
      for (const id of ["my/project", "a b\\c%2F", "preview-feature/refactor", "こんにちは", ""]) {
        const segment = cacheNamespaceSegment(id);
        assertEquals(
          /^[a-z0-9-]+$/.test(segment),
          true,
          `segment must be path-safe and case-insensitive: ${segment}`,
        );
      }
    });

    it("keeps segments distinct on case-insensitive filesystems", () => {
      // Directory names fold by case on macOS/Windows, so a case-sensitive
      // encoding could hand two content sources the same cache directory.
      const ids = ["Preview-A", "preview-a", "PREVIEW-A", "release/v1", "RELEASE/V1"];
      const folded = new Set(ids.map((id) => cacheNamespaceSegment(id).toLowerCase()));
      assertEquals(folded.size, ids.length);
    });

    it("does not nest slash-containing identifiers under their prefixes", () => {
      const parent = cacheNamespaceSegment("preview-feature");
      const child = cacheNamespaceSegment("preview-feature/refactor");
      assertEquals(child.includes("/"), false);
      assertNotEquals(parent, child);
    });

    it("bounds segment length for oversized identifiers while keeping them distinct", () => {
      const base = "x".repeat(4096);
      const first = cacheNamespaceSegment(`${base}a`);
      const second = cacheNamespaceSegment(`${base}b`);

      assertEquals(first.length <= 160, true, `oversized segment must stay bounded: ${first}`);
      assertEquals(/^[a-z0-9-]+$/.test(first), true);
      assertNotEquals(first, second);
    });

    it("keeps unpaired surrogates distinct from the replacement character", () => {
      // UTF-8 encoding folds an unpaired surrogate to U+FFFD, which would hand
      // "\uD800" and "�" the same cache namespace.
      assertNotEquals(cacheNamespaceSegment("\uD800"), cacheNamespaceSegment("�"));
      assertNotEquals(cacheNamespaceSegment("\uDC00"), cacheNamespaceSegment("�"));
      assertNotEquals(cacheNamespaceSegment("\uD800"), cacheNamespaceSegment("\uDC00"));
      assertEquals(/^[a-z0-9-]+$/.test(cacheNamespaceSegment("\uD800")), true);
    });

    it("encodes well-formed identifiers as their UTF-8 bytes", () => {
      const utf8Hex = (value: string) =>
        Array.from(new TextEncoder().encode(value))
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join("");

      for (const id of ["branch-main", "こんにちは", "😀", "a b\\c%2F", ""]) {
        assertEquals(cacheNamespaceSegment(id), `id-${utf8Hex(id)}`);
      }
    });

    it("derives oversized segments without ambient hashing intrinsics", () => {
      const originalCharCodeAt = String.prototype.charCodeAt;
      const originalBigIntToString = BigInt.prototype.toString;
      const oversized = `${"z".repeat(4096)}tail`;

      let segment: string | undefined;
      try {
        // deno-lint-ignore no-explicit-any
        (String.prototype as any).charCodeAt = () => 0x61;
        // deno-lint-ignore no-explicit-any
        (BigInt.prototype as any).toString = () => "x";
        segment = cacheNamespaceSegment(oversized);
      } finally {
        String.prototype.charCodeAt = originalCharCodeAt;
        BigInt.prototype.toString = originalBigIntToString;
      }

      assertEquals(segment, cacheNamespaceSegment(oversized));
      assertNotEquals(segment, "h-x-x");
      assertNotEquals(segment, cacheNamespaceSegment(`${"z".repeat(4096)}other`));
    });

    it("keeps inline and hashed forms in disjoint namespaces", () => {
      const inline = cacheNamespaceSegment("short-id");
      const hashed = cacheNamespaceSegment("y".repeat(4096));
      assertEquals(inline.startsWith("id-"), true);
      assertEquals(hashed.startsWith("h-"), true);
    });
  });
});

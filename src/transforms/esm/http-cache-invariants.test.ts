import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  asBundleHash,
  asLocalModuleCode,
  assertLocal,
  assertPortable,
  CACHE_DIR_TOKEN,
  VeryfrontError,
} from "./http-cache-invariants.ts";

describe("transforms/esm/http-cache-invariants", () => {
  // Consumers such as bundle-recovery match on the slug, not the message, so
  // every invariant failure must carry the registry's identity.
  function assertCacheInvariantViolation(fn: () => unknown, why: string): void {
    const error = assertThrows(fn, VeryfrontError, undefined, why) as VeryfrontError;
    assertEquals(
      error.slug,
      "cache-invariant-violation",
      `${why}: consumers match on the cache-invariant-violation slug`,
    );
    assertEquals(error.status, 500, `${why}: the registry classifies this as a 500`);
  }

  describe("CACHE_DIR_TOKEN", () => {
    it("is a non-empty string", () => {
      assertEquals(typeof CACHE_DIR_TOKEN, "string");
      assertEquals(CACHE_DIR_TOKEN.length > 0, true);
    });
  });

  describe("assertPortable", () => {
    it("does not throw for code without hardcoded paths", () => {
      const code =
        `import foo from "file://${CACHE_DIR_TOKEN}/veryfront-http-bundle/http-123.mjs";`;
      // Should not throw
      assertPortable(code as never);
    });

    it("throws when code still contains hardcoded cache paths", () => {
      assertCacheInvariantViolation(
        () =>
          assertPortable(
            `import a from "file:///app/.cache/veryfront-http-bundle/http-111111.mjs";` as never,
          ),
        "non-portable code must never reach the distributed cache",
      );
    });

    it("does not throw for plain JavaScript code", () => {
      assertPortable("const x = 1;" as never);
    });
  });

  describe("assertLocal", () => {
    it("does not throw for code without tokens", () => {
      const code = `import foo from "file:///home/user/.cache/veryfront-http-bundle/http-123.mjs";`;
      assertLocal(code as never);
    });

    it("throws for code containing CACHE_DIR_TOKEN", () => {
      const code =
        `import foo from "file://${CACHE_DIR_TOKEN}/veryfront-http-bundle/http-123.mjs";`;
      assertCacheInvariantViolation(
        () => assertLocal(code as never),
        "tokenized code must fail the local invariant",
      );
    });

    it("does not throw for plain JavaScript code", () => {
      assertLocal("const x = 1;" as never);
    });
  });

  describe("asBundleHash", () => {
    it("accepts numeric hash strings", () => {
      const hash = asBundleHash("12345");
      assertEquals(typeof hash, "string");
    });

    it("throws for non-numeric hash", () => {
      assertCacheInvariantViolation(
        () => asBundleHash("abc-not-numeric"),
        "a non-hexadecimal hash must fail the bundle-hash invariant",
      );
    });

    it("throws for empty string", () => {
      assertCacheInvariantViolation(
        () => asBundleHash(""),
        "an empty hash must fail the bundle-hash invariant",
      );
    });

    it("accepts large numeric strings", () => {
      const hash = asBundleHash("999999999999");
      assertEquals(typeof hash, "string");
    });

    it("accepts full lowercase SHA-256 hashes", () => {
      const hash = asBundleHash(
        "d9daafa3b706faf7af89c03417596d23beed4c1ae964d7ee7ead5d335b683412",
      );
      assertEquals(typeof hash, "string");
    });

    it("rejects shortened hexadecimal hashes", () => {
      assertCacheInvariantViolation(
        () => asBundleHash("d9daafa3b706faf7"),
        "a shortened hexadecimal hash must fail the bundle-hash invariant",
      );
    });

    it("rejects uppercase SHA-256 hashes", () => {
      assertCacheInvariantViolation(
        () =>
          asBundleHash(
            "D9DAAFA3B706FAF7AF89C03417596D23BEED4C1AE964D7EE7EAD5D335B683412",
          ),
        "an uppercase SHA-256 hash must fail the bundle-hash invariant",
      );
    });
  });

  describe("asLocalModuleCode", () => {
    it("returns code as LocalModuleCode for valid local code", () => {
      const code = "const x = 1;";
      const result = asLocalModuleCode(code);
      assertEquals(typeof result, "string");
    });

    it("throws for code containing portable tokens", () => {
      const code = `import foo from "file://${CACHE_DIR_TOKEN}/test.mjs";`;
      assertCacheInvariantViolation(
        () => asLocalModuleCode(code),
        "tokenized code must never be branded as local module code",
      );
    });
  });
});

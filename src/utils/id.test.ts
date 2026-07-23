import "#veryfront/schemas/_test-setup.ts";
import { describe, it } from "#veryfront/testing/bdd";
import { assertEquals, assertMatch, assertThrows } from "#veryfront/testing/assert";
import { createIdGenerator, generateId, generateUuid } from "./id.ts";

describe("id", () => {
  describe("generateUuid", () => {
    it("uses native randomUUID when available", () => {
      assertEquals(
        generateUuid({ randomUUID: () => "00000000-0000-4000-8000-000000000000" }),
        "00000000-0000-4000-8000-000000000000",
      );
    });

    it("builds a version 4 UUID from secure random bytes", () => {
      const uuid = generateUuid({
        getRandomValues(bytes) {
          bytes.forEach((_, index) => bytes[index] = index);
          return bytes;
        },
      });

      assertEquals(uuid, "00010203-0405-4607-8809-0a0b0c0d0e0f");
    });

    it("falls back when randomUUID returns a malformed value", () => {
      const uuid = generateUuid({
        randomUUID: () => "not-a-uuid",
        getRandomValues(bytes) {
          bytes.fill(0);
          return bytes;
        },
      });
      assertEquals(uuid, "00000000-0000-4000-8000-000000000000");
    });

    it("fails explicitly when secure randomness is unavailable", () => {
      assertThrows(
        () => generateUuid(null),
        Error,
        "Web Crypto with getRandomValues is required",
      );
    });
  });

  describe("generateId", () => {
    it("should generate a 16-character ID without prefix", () => {
      const id = generateId();
      assertEquals(id.length, 16);
      assertMatch(id, /^[0-9a-zA-Z]{16}$/);
    });

    it("should generate ID with prefix", () => {
      assertMatch(generateId("msg"), /^msg-[0-9a-zA-Z]{16}$/);
    });

    it("should generate unique IDs", () => {
      const ids = new Set<string>();

      for (let i = 0; i < 100; i++) {
        ids.add(generateId());
      }

      assertEquals(ids.size, 100);
    });
  });

  describe("createIdGenerator", () => {
    it("should create generator with prefix", () => {
      const generate = createIdGenerator({ prefix: "test" });
      assertMatch(generate(), /^test-[0-9a-zA-Z]{16}$/);
    });

    it("should use custom separator", () => {
      const generate = createIdGenerator({ prefix: "test", separator: "_" });
      assertMatch(generate(), /^test_[0-9a-zA-Z]{16}$/);
    });

    it("should use custom size", () => {
      const generate = createIdGenerator({ size: 8 });
      const id = generate();
      assertEquals(id.length, 8);
      assertMatch(id, /^[0-9a-zA-Z]{8}$/);
    });

    it("should generate without prefix", () => {
      const generate = createIdGenerator({});
      assertEquals(generate().length, 16);
    });

    it("rejects non-integer and unbounded sizes at construction time", () => {
      for (const size of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 1_025]) {
        assertThrows(
          () => createIdGenerator({ size }),
          RangeError,
          "size must be an integer between 1 and 1024",
        );
      }
    });
  });
});

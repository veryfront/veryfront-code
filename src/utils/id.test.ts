import { describe, it } from "@veryfront/testing/bdd";
import { assertEquals, assertMatch } from "@veryfront/testing/assert";
import { createIdGenerator, generateId } from "./id.ts";

describe("id", () => {
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
  });
});

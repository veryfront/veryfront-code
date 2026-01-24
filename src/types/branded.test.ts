import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  type AuthToken,
  brandValue,
  type EntityId,
  isBrandedString,
  type Slug,
  unbrandValue,
  type UserId,
} from "./branded.ts";

describe("branded.ts", () => {
  describe("brandValue", () => {
    it("should create branded values", () => {
      assertEquals(brandValue<UserId>("user-123"), "user-123");
      assertEquals(brandValue<EntityId>("entity-456"), "entity-456");
      assertEquals(brandValue<Slug>("/blog/my-post"), "/blog/my-post");
      assertEquals(brandValue<AuthToken>("secret-token-abc"), "secret-token-abc");
    });

    it("should preserve empty strings", () => {
      assertEquals(brandValue<Slug>(""), "");
    });
  });

  describe("isBrandedString", () => {
    it("should return true for string values", () => {
      assertEquals(isBrandedString("hello"), true);
      assertEquals(isBrandedString(""), true);
      assertEquals(isBrandedString("123"), true);
    });

    it("should return true for branded values", () => {
      assertEquals(isBrandedString(brandValue<UserId>("user-123")), true);
    });

    it("should return false for non-string values", () => {
      const nonStrings = [123, null, undefined, {}, [], true] as const;

      for (const value of nonStrings) {
        assertEquals(isBrandedString(value), false);
      }
    });
  });

  describe("unbrandValue", () => {
    it("should unwrap branded values to string", () => {
      const userId = brandValue<UserId>("user-123");
      const slug = brandValue<Slug>("/docs/intro");
      const empty = brandValue<EntityId>("");

      const unwrappedUserId = unbrandValue(userId);
      assertEquals(unwrappedUserId, "user-123");
      assertEquals(typeof unwrappedUserId, "string");

      assertEquals(unbrandValue(slug), "/docs/intro");
      assertEquals(unbrandValue(empty), "");
    });
  });

  describe("type safety (compile-time tests)", () => {
    it("should allow branded values to be used as strings", () => {
      const userId = brandValue<UserId>("user-123");
      const upper = userId.toUpperCase();
      const length = userId.length;

      assertEquals(upper, "USER-123");
      assertEquals(length, 8);
    });

    it("should allow string methods on branded values", () => {
      const slug = brandValue<Slug>("/blog/post-1");
      assertEquals(slug.startsWith("/blog"), true);
      assertEquals(slug.split("/").length, 3);
    });
  });
});

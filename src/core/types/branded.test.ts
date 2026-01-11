import { assertEquals } from "jsr:@std/assert@1";
import { describe, it } from "jsr:@std/testing@1/bdd";
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
    it("should create a branded UserId", () => {
      const userId = brandValue<UserId>("user-123");
      assertEquals(userId, "user-123");
    });

    it("should create a branded EntityId", () => {
      const entityId = brandValue<EntityId>("entity-456");
      assertEquals(entityId, "entity-456");
    });

    it("should create a branded Slug", () => {
      const slug = brandValue<Slug>("/blog/my-post");
      assertEquals(slug, "/blog/my-post");
    });

    it("should create a branded AuthToken", () => {
      const token = brandValue<AuthToken>("secret-token-abc");
      assertEquals(token, "secret-token-abc");
    });

    it("should preserve empty strings", () => {
      const empty = brandValue<Slug>("");
      assertEquals(empty, "");
    });
  });

  describe("isBrandedString", () => {
    it("should return true for string values", () => {
      assertEquals(isBrandedString("hello"), true);
      assertEquals(isBrandedString(""), true);
      assertEquals(isBrandedString("123"), true);
    });

    it("should return true for branded values", () => {
      const userId = brandValue<UserId>("user-123");
      assertEquals(isBrandedString(userId), true);
    });

    it("should return false for non-string values", () => {
      assertEquals(isBrandedString(123), false);
      assertEquals(isBrandedString(null), false);
      assertEquals(isBrandedString(undefined), false);
      assertEquals(isBrandedString({}), false);
      assertEquals(isBrandedString([]), false);
      assertEquals(isBrandedString(true), false);
    });
  });

  describe("unbrandValue", () => {
    it("should unwrap branded UserId to string", () => {
      const userId = brandValue<UserId>("user-123");
      const unwrapped = unbrandValue(userId);
      assertEquals(unwrapped, "user-123");
      assertEquals(typeof unwrapped, "string");
    });

    it("should unwrap branded Slug to string", () => {
      const slug = brandValue<Slug>("/docs/intro");
      const unwrapped = unbrandValue(slug);
      assertEquals(unwrapped, "/docs/intro");
    });

    it("should handle empty branded strings", () => {
      const empty = brandValue<EntityId>("");
      const unwrapped = unbrandValue(empty);
      assertEquals(unwrapped, "");
    });
  });

  describe("type safety (compile-time tests)", () => {
    it("should allow branded values to be used as strings", () => {
      const userId = brandValue<UserId>("user-123");
      // These operations should compile because branded types extend string
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

import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assert } from "std/assert/mod.ts";
import {
  brandValue,
  isBrandedString,
  unbrandValue,
  type EntityId,
  type UserId,
  type Slug,
  type AuthToken,
} from "./branded.ts";

describe("types/branded", () => {
  describe("brandValue", () => {
    it("should brand a string value", () => {
      const userId = brandValue<UserId>("user-123");
      assertEquals(typeof userId, "string");
      assertEquals(userId, "user-123");
    });

    it("should work with EntityId", () => {
      const entityId = brandValue<EntityId>("entity-456");
      assertEquals(entityId, "entity-456");
    });

    it("should work with Slug", () => {
      const slug = brandValue<Slug>("my-page-slug");
      assertEquals(slug, "my-page-slug");
    });

    it("should work with AuthToken", () => {
      const token = brandValue<AuthToken>("secret-token-789");
      assertEquals(token, "secret-token-789");
    });
  });

  describe("isBrandedString", () => {
    it("should return true for string values", () => {
      assertEquals(isBrandedString("test"), true);
      assertEquals(isBrandedString(""), true);
      assertEquals(isBrandedString("hello world"), true);
    });

    it("should return false for non-string values", () => {
      assertEquals(isBrandedString(123), false);
      assertEquals(isBrandedString(null), false);
      assertEquals(isBrandedString(undefined), false);
      assertEquals(isBrandedString({}), false);
      assertEquals(isBrandedString([]), false);
      assertEquals(isBrandedString(true), false);
    });

    it("should work with branded strings", () => {
      const userId = brandValue<UserId>("user-123");
      assertEquals(isBrandedString(userId), true);
    });
  });

  describe("unbrandValue", () => {
    it("should unbrand a branded string", () => {
      const userId = brandValue<UserId>("user-123");
      const unbranded = unbrandValue(userId);
      assertEquals(typeof unbranded, "string");
      assertEquals(unbranded, "user-123");
    });

    it("should preserve the original value", () => {
      const original = "entity-789";
      const branded = brandValue<EntityId>(original);
      const unbranded = unbrandValue(branded);
      assertEquals(unbranded, original);
    });

    it("should work with different branded types", () => {
      const slug = brandValue<Slug>("test-slug");
      const token = brandValue<AuthToken>("test-token");

      assertEquals(unbrandValue(slug), "test-slug");
      assertEquals(unbrandValue(token), "test-token");
    });
  });

  describe("branding roundtrip", () => {
    it("should preserve value through brand and unbrand", () => {
      const original = "test-value";
      const branded = brandValue<UserId>(original);
      const unbranded = unbrandValue(branded);
      assertEquals(unbranded, original);
    });

    it("should work with empty strings", () => {
      const original = "";
      const branded = brandValue<EntityId>(original);
      const unbranded = unbrandValue(branded);
      assertEquals(unbranded, original);
    });

    it("should work with special characters", () => {
      const original = "user@example.com";
      const branded = brandValue<UserId>(original);
      const unbranded = unbrandValue(branded);
      assertEquals(unbranded, original);
    });
  });

  describe("type safety", () => {
    it("should maintain type distinction at runtime", () => {
      const userId = brandValue<UserId>("user-123");
      const entityId = brandValue<EntityId>("entity-123");

      // At runtime, they're both strings
      assertEquals(typeof userId, "string");
      assertEquals(typeof entityId, "string");

      // But logically represent different types
      assert(isBrandedString(userId));
      assert(isBrandedString(entityId));
    });
  });
});

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { CommonSchemas } from "./schemas.ts";

describe("CommonSchemas", () => {
  describe("email", () => {
    it("should accept valid email", () => {
      const result = CommonSchemas.email.safeParse("user@example.com");
      assertEquals(result.success, true);
    });

    it("should reject invalid email", () => {
      const result = CommonSchemas.email.safeParse("not-an-email");
      assertEquals(result.success, false);
    });

    it("should reject email exceeding 255 chars", () => {
      const longEmail = "a".repeat(247) + "@test.com";
      const result = CommonSchemas.email.safeParse(longEmail);
      assertEquals(result.success, false);
    });
  });

  describe("uuid", () => {
    it("should accept valid UUID", () => {
      const result = CommonSchemas.uuid.safeParse("550e8400-e29b-41d4-a716-446655440000");
      assertEquals(result.success, true);
    });

    it("should reject invalid UUID", () => {
      const result = CommonSchemas.uuid.safeParse("not-a-uuid");
      assertEquals(result.success, false);
    });
  });

  describe("slug", () => {
    it("should accept valid slug", () => {
      const result = CommonSchemas.slug.safeParse("my-project-123");
      assertEquals(result.success, true);
    });

    it("should reject slug with uppercase letters", () => {
      const result = CommonSchemas.slug.safeParse("My-Project");
      assertEquals(result.success, false);
    });

    it("should reject empty slug", () => {
      const result = CommonSchemas.slug.safeParse("");
      assertEquals(result.success, false);
    });

    it("should reject slug with spaces", () => {
      const result = CommonSchemas.slug.safeParse("my project");
      assertEquals(result.success, false);
    });

    it("should reject slug exceeding 100 chars", () => {
      const result = CommonSchemas.slug.safeParse("a".repeat(101));
      assertEquals(result.success, false);
    });
  });

  describe("url", () => {
    it("should accept valid URL", () => {
      const result = CommonSchemas.url.safeParse("https://example.com");
      assertEquals(result.success, true);
    });

    it("should reject invalid URL", () => {
      const result = CommonSchemas.url.safeParse("not a url");
      assertEquals(result.success, false);
    });
  });

  describe("phoneNumber", () => {
    it("should accept valid phone number with country code", () => {
      const result = CommonSchemas.phoneNumber.safeParse("+14155551234");
      assertEquals(result.success, true);
    });

    it("should accept valid phone number without plus", () => {
      const result = CommonSchemas.phoneNumber.safeParse("14155551234");
      assertEquals(result.success, true);
    });

    it("should reject phone number starting with 0", () => {
      const result = CommonSchemas.phoneNumber.safeParse("014155551234");
      assertEquals(result.success, false);
    });

    it("should reject phone number with letters", () => {
      const result = CommonSchemas.phoneNumber.safeParse("+1415abc1234");
      assertEquals(result.success, false);
    });
  });

  describe("pagination", () => {
    it("should parse valid pagination params", () => {
      const result = CommonSchemas.pagination.safeParse({
        page: 2,
        limit: 25,
        sort: "name",
        order: "asc",
      });
      assertEquals(result.success, true);
      if (result.success) {
        assertEquals(result.data.page, 2);
        assertEquals(result.data.limit, 25);
        assertEquals(result.data.sort, "name");
        assertEquals(result.data.order, "asc");
      }
    });

    it("should use defaults for missing page and limit", () => {
      const result = CommonSchemas.pagination.safeParse({});
      assertEquals(result.success, true);
      if (result.success) {
        assertEquals(result.data.page, 1);
        assertEquals(result.data.limit, 10);
      }
    });

    it("should coerce string numbers", () => {
      const result = CommonSchemas.pagination.safeParse({ page: "3", limit: "20" });
      assertEquals(result.success, true);
      if (result.success) {
        assertEquals(result.data.page, 3);
        assertEquals(result.data.limit, 20);
      }
    });

    it("should reject negative page numbers", () => {
      const result = CommonSchemas.pagination.safeParse({ page: -1 });
      assertEquals(result.success, false);
    });

    it("should reject limit exceeding 100", () => {
      const result = CommonSchemas.pagination.safeParse({ limit: 101 });
      assertEquals(result.success, false);
    });

    it("should reject invalid order values", () => {
      const result = CommonSchemas.pagination.safeParse({ order: "random" });
      assertEquals(result.success, false);
    });
  });

  describe("dateRange", () => {
    it("should accept valid date range", () => {
      const result = CommonSchemas.dateRange.safeParse({
        from: "2024-01-01T00:00:00Z",
        to: "2024-12-31T23:59:59Z",
      });
      assertEquals(result.success, true);
    });

    it("should accept same from and to dates", () => {
      const result = CommonSchemas.dateRange.safeParse({
        from: "2024-06-15T12:00:00Z",
        to: "2024-06-15T12:00:00Z",
      });
      assertEquals(result.success, true);
    });

    it("should reject when from is after to", () => {
      const result = CommonSchemas.dateRange.safeParse({
        from: "2024-12-31T00:00:00Z",
        to: "2024-01-01T00:00:00Z",
      });
      assertEquals(result.success, false);
    });

    it("should reject non-datetime strings", () => {
      const result = CommonSchemas.dateRange.safeParse({
        from: "yesterday",
        to: "today",
      });
      assertEquals(result.success, false);
    });
  });

  describe("strongPassword", () => {
    it("should accept strong password", () => {
      const result = CommonSchemas.strongPassword.safeParse("MyP@ssw0rd!");
      assertEquals(result.success, true);
    });

    it("should reject password shorter than 8 characters", () => {
      const result = CommonSchemas.strongPassword.safeParse("A1@b");
      assertEquals(result.success, false);
    });

    it("should reject password without uppercase", () => {
      const result = CommonSchemas.strongPassword.safeParse("myp@ssw0rd!");
      assertEquals(result.success, false);
    });

    it("should reject password without lowercase", () => {
      const result = CommonSchemas.strongPassword.safeParse("MYP@SSW0RD!");
      assertEquals(result.success, false);
    });

    it("should reject password without number", () => {
      const result = CommonSchemas.strongPassword.safeParse("MyP@ssword!");
      assertEquals(result.success, false);
    });

    it("should reject password without special character", () => {
      const result = CommonSchemas.strongPassword.safeParse("MyPassw0rd");
      assertEquals(result.success, false);
    });
  });
});

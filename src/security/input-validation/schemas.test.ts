import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { CommonSchemas } from "./schemas.ts";

function assertParseSuccess<T>(
  result: { success: boolean; data?: T },
): asserts result is { success: true; data: T } {
  assertEquals(result.success, true);
}

function assertParseFailure(result: { success: boolean }): void {
  assertEquals(result.success, false);
}

describe("CommonSchemas", () => {
  describe("email", () => {
    it("should accept valid email", () => {
      assertParseSuccess(CommonSchemas.email.safeParse("user@example.com"));
    });

    it("should reject invalid email", () => {
      assertParseFailure(CommonSchemas.email.safeParse("not-an-email"));
    });

    it("should reject email exceeding 255 chars", () => {
      const longEmail = "a".repeat(247) + "@test.com";
      assertParseFailure(CommonSchemas.email.safeParse(longEmail));
    });
  });

  describe("uuid", () => {
    it("should accept valid UUID", () => {
      assertParseSuccess(CommonSchemas.uuid.safeParse("550e8400-e29b-41d4-a716-446655440000"));
    });

    it("should reject invalid UUID", () => {
      assertParseFailure(CommonSchemas.uuid.safeParse("not-a-uuid"));
    });
  });

  describe("slug", () => {
    it("should accept valid slug", () => {
      assertParseSuccess(CommonSchemas.slug.safeParse("my-project-123"));
    });

    it("should reject slug with uppercase letters", () => {
      assertParseFailure(CommonSchemas.slug.safeParse("My-Project"));
    });

    it("should reject empty slug", () => {
      assertParseFailure(CommonSchemas.slug.safeParse(""));
    });

    it("should reject slug with spaces", () => {
      assertParseFailure(CommonSchemas.slug.safeParse("my project"));
    });

    it("should reject slug exceeding 100 chars", () => {
      assertParseFailure(CommonSchemas.slug.safeParse("a".repeat(101)));
    });
  });

  describe("url", () => {
    it("should accept valid URL", () => {
      assertParseSuccess(CommonSchemas.url.safeParse("https://example.com"));
    });

    it("should reject invalid URL", () => {
      assertParseFailure(CommonSchemas.url.safeParse("not a url"));
    });
  });

  describe("phoneNumber", () => {
    it("should accept valid phone number with country code", () => {
      assertParseSuccess(CommonSchemas.phoneNumber.safeParse("+14155551234"));
    });

    it("should accept valid phone number without plus", () => {
      assertParseSuccess(CommonSchemas.phoneNumber.safeParse("14155551234"));
    });

    it("should reject phone number starting with 0", () => {
      assertParseFailure(CommonSchemas.phoneNumber.safeParse("014155551234"));
    });

    it("should reject phone number with letters", () => {
      assertParseFailure(CommonSchemas.phoneNumber.safeParse("+1415abc1234"));
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

      assertParseSuccess(result);
      assertEquals(result.data.page, 2);
      assertEquals(result.data.limit, 25);
      assertEquals(result.data.sort, "name");
      assertEquals(result.data.order, "asc");
    });

    it("should use defaults for missing page and limit", () => {
      const result = CommonSchemas.pagination.safeParse({});

      assertParseSuccess(result);
      assertEquals(result.data.page, 1);
      assertEquals(result.data.limit, 10);
    });

    it("should coerce string numbers", () => {
      const result = CommonSchemas.pagination.safeParse({ page: "3", limit: "20" });

      assertParseSuccess(result);
      assertEquals(result.data.page, 3);
      assertEquals(result.data.limit, 20);
    });

    it("should reject negative page numbers", () => {
      assertParseFailure(CommonSchemas.pagination.safeParse({ page: -1 }));
    });

    it("should reject limit exceeding 100", () => {
      assertParseFailure(CommonSchemas.pagination.safeParse({ limit: 101 }));
    });

    it("should reject invalid order values", () => {
      assertParseFailure(CommonSchemas.pagination.safeParse({ order: "random" }));
    });
  });

  describe("dateRange", () => {
    it("should accept valid date range", () => {
      assertParseSuccess(
        CommonSchemas.dateRange.safeParse({
          from: "2024-01-01T00:00:00Z",
          to: "2024-12-31T23:59:59Z",
        }),
      );
    });

    it("should accept same from and to dates", () => {
      assertParseSuccess(
        CommonSchemas.dateRange.safeParse({
          from: "2024-06-15T12:00:00Z",
          to: "2024-06-15T12:00:00Z",
        }),
      );
    });

    it("should reject when from is after to", () => {
      assertParseFailure(
        CommonSchemas.dateRange.safeParse({
          from: "2024-12-31T00:00:00Z",
          to: "2024-01-01T00:00:00Z",
        }),
      );
    });

    it("should reject non-datetime strings", () => {
      assertParseFailure(
        CommonSchemas.dateRange.safeParse({
          from: "yesterday",
          to: "today",
        }),
      );
    });
  });

  describe("strongPassword", () => {
    it("should accept strong password", () => {
      assertParseSuccess(CommonSchemas.strongPassword.safeParse("MyP@ssw0rd!"));
    });

    it("should reject password shorter than 8 characters", () => {
      assertParseFailure(CommonSchemas.strongPassword.safeParse("A1@b"));
    });

    it("should reject password without uppercase", () => {
      assertParseFailure(CommonSchemas.strongPassword.safeParse("myp@ssw0rd!"));
    });

    it("should reject password without lowercase", () => {
      assertParseFailure(CommonSchemas.strongPassword.safeParse("MYP@SSW0RD!"));
    });

    it("should reject password without number", () => {
      assertParseFailure(CommonSchemas.strongPassword.safeParse("MyP@ssword!"));
    });

    it("should reject password without special character", () => {
      assertParseFailure(CommonSchemas.strongPassword.safeParse("MyPassw0rd"));
    });
  });
});

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { readIntegrationFailureCondition } from "./integration-condition.ts";

describe("safe integration condition metadata", () => {
  const condition = { slug: "rate-limit-exceeded", status: 429, retryable: true };
  it("preserves retry seconds without copying provider-private extensions", () => {
    assertEquals(
      readIntegrationFailureCondition({
        ...condition,
        retry_after_seconds: 17,
        provider_secret: "synthetic",
      }),
      { ...condition, retry_after_seconds: 17 },
    );
  });
  it("ignores malformed optional retry metadata while retaining the valid condition", () => {
    for (const retry_after_seconds of [-1, NaN, Infinity, "17", null]) {
      assertEquals(
        readIntegrationFailureCondition({ ...condition, retry_after_seconds }),
        condition,
      );
    }
  });
  it("does not accept malformed core conditions", () => {
    for (
      const value of [
        null,
        [],
        { slug: condition.slug, status: condition.status },
        { ...condition, slug: "bad slug" },
        { ...condition, status: 200 },
        {
          ...condition,
          retryable: "true",
        },
      ]
    ) {
      assertEquals(readIntegrationFailureCondition(value), undefined);
    }
  });
});

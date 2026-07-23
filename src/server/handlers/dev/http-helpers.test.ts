import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { errorResponse, jsonResponse } from "./http-helpers.ts";

describe("server/dev HTTP helpers", () => {
  it("keeps JSON responses private and prevents content sniffing", () => {
    for (const response of [jsonResponse({ ok: true }), errorResponse("Failed")]) {
      assertEquals(response.headers.get("cache-control"), "no-store");
      assertEquals(response.headers.get("content-type"), "application/json; charset=utf-8");
      assertEquals(response.headers.get("x-content-type-options"), "nosniff");
    }
  });
});

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  DEFAULT_RATE_LIMIT_REQUESTS,
  DEFAULT_RATE_LIMIT_WINDOW_MS,
  DEFAULT_SANDBOX_TIMEOUT_MS,
  HTTP_STATUS_FORBIDDEN,
  HTTP_STATUS_NO_CONTENT,
  HTTP_STATUS_TOO_MANY_REQUESTS,
} from "./constants.ts";

describe("sandbox constants", () => {
  it("should define HTTP status codes", () => {
    assertEquals(HTTP_STATUS_NO_CONTENT, 204);
    assertEquals(HTTP_STATUS_FORBIDDEN, 403);
    assertEquals(HTTP_STATUS_TOO_MANY_REQUESTS, 429);
  });

  it("should define rate limit defaults", () => {
    assertEquals(DEFAULT_RATE_LIMIT_REQUESTS, 100);
    assertEquals(DEFAULT_RATE_LIMIT_WINDOW_MS, 60_000);
  });

  it("should define sandbox timeout", () => {
    assertEquals(DEFAULT_SANDBOX_TIMEOUT_MS, 5000);
  });
});

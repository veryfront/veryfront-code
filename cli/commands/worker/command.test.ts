import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { formatRedisLogTarget } from "./command.ts";

describe("commands/worker/command", () => {
  it("removes Redis credentials and query values from user-facing output", () => {
    assertEquals(
      formatRedisLogTarget("rediss://worker:REDACTED@example.com:6380/2?token=REDACTED"),
      "<configured>",
    );
    assertEquals(formatRedisLogTarget("redis://localhost:6379"), "<configured>");
    assertEquals(formatRedisLogTarget("https://example.com/cache"), "<configured>");
    assertEquals(formatRedisLogTarget("redis://example.com/non-database-path"), "<configured>");
    assertEquals(formatRedisLogTarget("not a URL"), "<configured>");
  });
});

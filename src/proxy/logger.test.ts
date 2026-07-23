import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { proxyLogger } from "./logger.ts";

describe("proxy logger safety", () => {
  it("redacts secrets in messages, nested context, URLs, and errors", () => {
    const originalLog = console.log;
    const output: string[] = [];
    console.log = (...values: unknown[]) => output.push(values.map(String).join(" "));

    try {
      proxyLogger.error(
        "request failed authorization=Bearer message-secret",
        {
          authorization: "Bearer context-secret",
          headers: { cookie: "session=nested-secret", accept: "application/json" },
          endpoint: "https://user:url-secret@example.test/path?access_token=query-secret&page=2",
          error: "dial internal-context.example:8443",
        },
        new Error("connection to internal-host.example failed token=error-secret"),
      );
      proxyLogger.error("non-Error failure", "token=string-secret");
      proxyLogger.child({ component: "test" }).error(
        "child non-Error failure",
        "token=child-string-secret",
      );
      proxyLogger.info("safe message\nforged log entry");
    } finally {
      console.log = originalLog;
    }

    const serialized = output.join("\n");
    assertStringIncludes(serialized, "[REDACTED]");
    assertEquals(serialized.includes("\nforged log entry"), false);
    for (
      const secret of [
        "message-secret",
        "context-secret",
        "nested-secret",
        "url-secret",
        "query-secret",
        "error-secret",
        "string-secret",
        "child-string-secret",
        "internal-host.example",
        "internal-context.example",
      ]
    ) {
      assertEquals(serialized.includes(secret), false);
    }
  });
});

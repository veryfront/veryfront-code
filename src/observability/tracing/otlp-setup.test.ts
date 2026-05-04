import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

describe("observability/tracing/otlp-setup", () => {
  it("withSpan should execute the callback when OTLP is unavailable", async () => {
    const { withSpan } = await import("./otlp-setup.ts");

    const result = await withSpan("test.operation", async () => "ok");

    assertEquals(result, "ok");
  });

  it("withSpanSync should execute the callback when OTLP is unavailable", async () => {
    const { withSpanSync } = await import("./otlp-setup.ts");

    const result = withSpanSync("test.operation", () => "ok");

    assertEquals(result, "ok");
  });

  it("extractContext should return the active context (shim returns noop context)", async () => {
    const { extractContext } = await import("./otlp-setup.ts");

    // With the api-shim, extractContext always returns a context object (noop when no provider).
    const ctx = extractContext(new Headers());
    assertExists(ctx);
  });

  it("injectContext should leave headers unchanged when APIs are unavailable", async () => {
    const { injectContext } = await import("./otlp-setup.ts");
    const headers = new Headers([["x-test", "1"]]);

    injectContext(headers);

    assertEquals(Array.from(headers.entries()), [["x-test", "1"]]);
  });

  it("withContext should execute the callback when APIs are unavailable", async () => {
    const { withContext } = await import("./otlp-setup.ts");

    const result = await withContext({ trace: "ctx" }, async () => "ok");

    assertEquals(result, "ok");
  });

  it("getTraceContext should return an empty object when no span is active", async () => {
    const { getTraceContext } = await import("./otlp-setup.ts");

    assertEquals(getTraceContext(), {});
  });
});

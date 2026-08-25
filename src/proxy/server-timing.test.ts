import "#veryfront/schemas/_test-setup.ts";

import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  createProxyServerTiming,
  markProxyServerTimingPhase,
  shouldEnableProxyServerTiming,
  withProxyServerTimingHeader,
} from "./server-timing.ts";

/** Headers that reject mutation the way a fetch() response's immutable guard does. */
class ImmutableHeaders extends Headers {
  override set(): never {
    throw new TypeError("Headers are immutable");
  }
  override append(): never {
    throw new TypeError("Headers are immutable");
  }
  override delete(): never {
    throw new TypeError("Headers are immutable");
  }
}

describe("proxy server timing", () => {
  afterEach(() => {
    Deno.env.delete("VERYFRONT_ENABLE_PROXY_SERVER_TIMING");
    Deno.env.delete("VERYFRONT_ENABLE_SERVER_TIMING");
  });

  it("uses the proxy-specific flag or shared server timing flag", () => {
    assertEquals(shouldEnableProxyServerTiming(), false);

    Deno.env.set("VERYFRONT_ENABLE_SERVER_TIMING", "1");
    assertEquals(shouldEnableProxyServerTiming(), true);

    Deno.env.delete("VERYFRONT_ENABLE_SERVER_TIMING");
    Deno.env.set("VERYFRONT_ENABLE_PROXY_SERVER_TIMING", "1");
    assertEquals(shouldEnableProxyServerTiming(), true);
  });

  it("appends proxy metrics to an existing renderer Server-Timing header", () => {
    const timing = createProxyServerTiming(true);
    markProxyServerTimingPhase(timing, "proxy.resolve_request", 2.345);
    markProxyServerTimingPhase(timing, "proxy.upstream", 10);

    const response = withProxyServerTimingHeader(
      new Response("ok", {
        headers: { "Server-Timing": "total;dur=4.00, render.cache_hit;dur=0.00" },
      }),
      timing,
      15.556,
    );

    const header = response.headers.get("Server-Timing") ?? "";
    assertStringIncludes(header, "total;dur=4.00");
    assertStringIncludes(header, "render.cache_hit;dur=0.00");
    assertStringIncludes(header, "proxy.total;dur=15.56");
    assertStringIncludes(header, "proxy.resolve_request;dur=2.35");
    assertStringIncludes(header, "proxy.upstream;dur=10.00");
  });

  it("rebuilds a response whose headers are immutable without losing its status", async () => {
    // Every proxied response comes from fetch(), whose headers guard is
    // immutable, so the rebuild branch is the only one production ever takes.
    // The runtime only mints that guard for real network responses, so this
    // stands in for one: a real Response whose headers reject mutation exactly
    // the way the guard does, which is all the rebuild branch keys off.
    const upstream = new Response("upstream body", { status: 404, statusText: "Not Found" });
    Object.defineProperty(upstream, "headers", {
      configurable: true,
      get: () => new ImmutableHeaders({ "Server-Timing": "render.total;dur=4.00" }),
    });
    const timing = createProxyServerTiming(true);
    markProxyServerTimingPhase(timing, "proxy.upstream", 10);

    const result = withProxyServerTimingHeader(upstream, timing, 15.556);

    assertEquals(result.status, 404, "the rebuilt response must keep the upstream status");
    assertEquals(
      result.statusText,
      "Not Found",
      "the rebuilt response must keep the upstream status text",
    );
    const header = result.headers.get("Server-Timing") ?? "";
    assertStringIncludes(header, "render.total;dur=4.00");
    assertStringIncludes(header, "proxy.total;dur=15.56");
    assertStringIncludes(header, "proxy.upstream;dur=10.00");
    assertEquals(
      await result.text(),
      "upstream body",
      "the rebuilt response must keep the upstream body",
    );
  });

  it("leaves responses untouched when timing is disabled", () => {
    const response = withProxyServerTimingHeader(
      new Response("ok"),
      createProxyServerTiming(false),
      12,
    );

    assertEquals(response.headers.get("Server-Timing"), null);
  });
});

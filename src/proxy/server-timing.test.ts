import "#veryfront/schemas/_test-setup.ts";

import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  createProxyServerTiming,
  markProxyServerTimingPhase,
  shouldEnableProxyServerTiming,
  withProxyServerTimingHeader,
} from "./server-timing.ts";

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

  it("leaves responses untouched when timing is disabled", () => {
    const response = withProxyServerTimingHeader(
      new Response("ok"),
      createProxyServerTiming(false),
      12,
    );

    assertEquals(response.headers.get("Server-Timing"), null);
  });
});

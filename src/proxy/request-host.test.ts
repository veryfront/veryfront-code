import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import {
  normalizeProxyRequestAuthority,
  normalizeProxyRequestHost,
  resolveProxyRequestAuthority,
  resolveProxyRequestHost,
} from "./request-host.ts";

Deno.test("proxy request host normalization", async (t) => {
  await t.step("normalizes case, trailing dots, ports, and international names", () => {
    assertEquals(normalizeProxyRequestHost("Example.COM:8080"), "example.com");
    assertEquals(normalizeProxyRequestHost("example.com."), "example.com");
    assertEquals(normalizeProxyRequestHost("bücher.example"), "xn--bcher-kva.example");
    assertEquals(normalizeProxyRequestHost("[::1]:8080"), "[::1]");
  });

  await t.step("preserves a canonical browser-visible port separately from routing host", () => {
    assertEquals(
      normalizeProxyRequestAuthority("Example.COM.:03000"),
      "example.com:3000",
    );
    assertEquals(normalizeProxyRequestAuthority("[::1]:8080"), "[::1]:8080");

    const url = new URL("https://fallback.example/page");
    const request = new Request(url, { headers: { host: "project.example:8443" } });
    assertEquals(resolveProxyRequestHost(request, url), "project.example");
    assertEquals(resolveProxyRequestAuthority(request, url), "project.example:8443");
  });

  await t.step("prefers a valid Host header and falls back to the request URL", () => {
    const url = new URL("https://fallback.example/page");
    assertEquals(
      resolveProxyRequestHost(
        new Request(url, { headers: { host: "project.example:8443" } }),
        url,
      ),
      "project.example",
    );
    assertEquals(resolveProxyRequestHost(new Request(url), url), "fallback.example");
  });

  await t.step("rejects credentials and non-authority components", () => {
    for (
      const authority of [
        "",
        " example.com",
        "user@example.com",
        "example.com/path",
        "example.com?query",
        "example.com#fragment",
        "example.com\\path",
      ]
    ) {
      assertThrows(
        () => normalizeProxyRequestHost(authority),
        TypeError,
        "Host header is invalid",
      );
    }
  });
});

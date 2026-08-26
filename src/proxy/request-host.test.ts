import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  normalizeProxyRequestAuthority,
  normalizeProxyRequestHost,
  resolveProxyRequestAuthority,
  resolveProxyRequestHost,
} from "./request-host.ts";

describe("proxy request host normalization", () => {
  it("normalizes case, trailing dots, ports, and international names", () => {
    assertEquals(normalizeProxyRequestHost("Example.COM:8080"), "example.com");
    assertEquals(normalizeProxyRequestHost("example.com."), "example.com");
    assertEquals(normalizeProxyRequestHost("bücher.example"), "xn--bcher-kva.example");
    assertEquals(normalizeProxyRequestHost("[::1]:8080"), "[::1]");
  });

  it("preserves a canonical browser-visible port separately from routing host", () => {
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

  it("prefers a valid Host header and falls back to the request URL", () => {
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

  it("rejects credentials and non-authority components", () => {
    assertEquals(normalizeProxyRequestHost("example.com"), "example.com");
    for (
      const authority of [
        "",
        " example.com",
        "user@example.com",
        "example.com/path",
        "example.com?query",
        "example.com#fragment",
        "example.com\\path",
        "exam" + String.fromCharCode(9) + "ple.com",
        "example.com" + String.fromCharCode(0),
        "exam" + String.fromCharCode(13, 10) + "ple.com",
        "a".repeat(1025) + ".example",
        // Raw-socket inputs that make Deno synthesize an unparseable req.url
        // (veryfront-issue-inbox#828): each must be rejected, never parsed.
        "foo bar",
        "[",
        "example.test:notaport",
      ]
    ) {
      assertThrows(
        () => normalizeProxyRequestHost(authority),
        TypeError,
        "Host header is invalid",
        "a Host authority with embedded control characters or over the length bound must be rejected, not silently normalized",
      );
    }
  });

  it("rejects an empty Host header instead of falling back to the absolute-form authority", () => {
    // `GET http://evil.test/x HTTP/1.1` + `Host: ` produces a parseable
    // req.url with an empty Host header. "" is not nullish, so the url.host
    // fallback must not fire; the request is invalid and must throw for the
    // router to map to 400 (veryfront-issue-inbox#828).
    const url = new URL("http://evil.test/x");
    const request = new Request(url, { headers: { host: "" } });
    assertThrows(
      () => resolveProxyRequestHost(request, url),
      TypeError,
      "Host header is invalid",
    );
    assertThrows(
      () => resolveProxyRequestAuthority(request, url),
      TypeError,
      "Host header is invalid",
    );
  });
});

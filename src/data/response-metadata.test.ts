import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  appendDataResponseMetadata,
  mergeDataResponseMetadata,
  normalizeDataResponseMetadata,
  serializeResponseCookie,
} from "./response-metadata.ts";

describe("data response metadata", () => {
  it("normalizes header names and lets the page override a layout header", () => {
    const result = mergeDataResponseMetadata([
      { headers: { "X-Owner": "layout", "x-layout": "yes" } },
      { headers: { "x-owner": "page", "x-page": "yes" } },
    ]);

    assertEquals(result.headers, {
      "x-owner": "page",
      "x-layout": "yes",
      "x-page": "yes",
    });
  });

  it("rejects framework-owned and case-insensitively duplicate headers", () => {
    for (
      const name of [
        "Cache-Control",
        "Set-Cookie",
        "Access-Control-Allow-Origin",
        "Cross-Origin-Opener-Policy",
        "X-Veryfront-Dependency-Pins",
      ]
    ) {
      assertThrows(
        () => normalizeDataResponseMetadata({ headers: { [name]: "value" } }),
        TypeError,
        "cannot set framework-owned response header",
      );
    }
    assertThrows(
      () =>
        normalizeDataResponseMetadata({
          headers: { "X-Trace": "first", "x-trace": "second" },
        }),
      TypeError,
      'returned duplicate response header "x-trace"',
    );
    assertThrows(
      () => normalizeDataResponseMetadata({ headers: { "x-trace": "unsafe\u0001value" } }),
      TypeError,
      'returned invalid value for response header "x-trace"',
    );
    assertThrows(
      () => normalizeDataResponseMetadata({ headers: { "x-trace": "unsafe 🌟 value" } }),
      TypeError,
      'returned invalid value for response header "x-trace"',
    );
  });

  it("serializes cookie values and attributes without allowing header injection", () => {
    assertEquals(
      serializeResponseCookie({
        name: "session",
        value: "hello world",
        domain: "example.com",
        path: "/",
        expires: "Tue, 19 Jan 2038 03:14:07 GMT",
        maxAge: 60,
        httpOnly: true,
        secure: true,
        sameSite: "lax",
      }),
      "session=hello%20world; Domain=example.com; Path=/; " +
        "Expires=Tue, 19 Jan 2038 03:14:07 GMT; Max-Age=60; HttpOnly; Secure; SameSite=Lax",
    );
    assertThrows(
      () => serializeResponseCookie({ name: "session", value: "abc", path: "/\r\nunsafe" }),
      TypeError,
      "returned an invalid path",
    );
    assertThrows(
      () => serializeResponseCookie({ name: "session", value: "abc", path: "/\u0001unsafe" }),
      TypeError,
      "returned an invalid path",
    );
    assertThrows(
      () => serializeResponseCookie({ name: "session", value: "abc", path: "/🌟" }),
      TypeError,
      "returned an invalid path",
    );
    assertThrows(
      () => serializeResponseCookie({ name: "session", value: "🌟".repeat(1_000) }),
      TypeError,
      "exceeds the serialized size limit",
    );
  });

  it("appends custom headers and preserves distinct Set-Cookie fields", () => {
    const headers = new Headers({ "x-page-state": "framework" });
    appendDataResponseMetadata(headers, {
      headers: { "x-page-state": "application" },
      cookies: [
        { name: "first", value: "1", path: "/" },
        { name: "second", value: "2", secure: true, sameSite: "none" },
      ],
    });

    assertEquals(headers.get("x-page-state"), "framework, application");
    assertEquals(headers.getSetCookie(), [
      "first=1; Path=/",
      "second=2; Secure; SameSite=None",
    ]);
  });

  it("enforces secure cookie prefix and SameSite=None requirements", () => {
    assertThrows(
      () => serializeResponseCookie({ name: "__Secure-session", value: "abc" }),
      TypeError,
      "must set secure",
    );
    assertThrows(
      () =>
        serializeResponseCookie({
          name: "__Host-session",
          value: "abc",
          secure: true,
          path: "/account",
        }),
      TypeError,
      'must set secure, use path "/", and omit domain',
    );
    assertThrows(
      () => serializeResponseCookie({ name: "session", value: "abc", sameSite: "none" }),
      TypeError,
      'with sameSite "none" must set secure',
    );
  });
});

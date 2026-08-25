import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  appendDataResponseMetadata,
  getAttachedDataResponseMetadata,
  mergeDataResponseMetadata,
  normalizeDataResponseMetadata,
  serializeResponseCookie,
  unwrapDataResponseMetadataError,
  wrapDataResponseMetadataError,
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

  it("rejects metadata that exceeds aggregate response limits", () => {
    assertThrows(
      () =>
        mergeDataResponseMetadata([
          {
            headers: Object.fromEntries(
              Array.from({ length: 32 }, (_, index) => [`x-layout-${index}`, "value"]),
            ),
          },
          {
            headers: Object.fromEntries(
              Array.from({ length: 33 }, (_, index) => [`x-page-${index}`, "value"]),
            ),
          },
        ]),
      TypeError,
      "cannot return more than 64 response headers",
    );

    assertThrows(
      () =>
        mergeDataResponseMetadata([
          {
            cookies: Array.from({ length: 32 }, (_, index) => ({
              name: `layout-${index}`,
              value: "value",
            })),
          },
          {
            cookies: Array.from({ length: 33 }, (_, index) => ({
              name: `page-${index}`,
              value: "value",
            })),
          },
        ]),
      TypeError,
      "cannot return more than 64 response cookies",
    );
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

  it("rejects invalid response header names", () => {
    assertThrows(
      () => normalizeDataResponseMetadata({ headers: { "x trace": "value" } }),
      TypeError,
      "returned invalid response header name",
    );
    assertThrows(
      () => normalizeDataResponseMetadata({ headers: { "x-trace\r\nInjected": "value" } }),
      TypeError,
      "returned invalid response header name",
      "a header name carrying CRLF must be refused before it reaches Headers.append",
    );
    assertThrows(
      () => normalizeDataResponseMetadata({ headers: { "": "value" } }),
      TypeError,
      "returned invalid response header name",
    );
    assertThrows(
      () => normalizeDataResponseMetadata({ headers: { ["x".repeat(257)]: "value" } }),
      TypeError,
      "returned invalid response header name",
    );
    assertEquals(
      normalizeDataResponseMetadata({ headers: { ["x".repeat(256)]: "value" } }),
      { headers: { ["x".repeat(256)]: "value" } },
      "a header name at exactly the length limit must be accepted",
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

  it("carries an undefined failure without exposing metadata in the error", () => {
    const carrier = wrapDataResponseMetadataError(undefined, {
      headers: { "x-page-state": "resolved" },
      cookies: [{ name: "page-seen", value: "1", path: "/" }],
    });

    assertEquals(carrier.message, "Non-Error render failure");
    assertEquals(unwrapDataResponseMetadataError(carrier), undefined);
    assertEquals(getAttachedDataResponseMetadata(carrier), {
      headers: { "x-page-state": "resolved" },
      cookies: [{ name: "page-seen", value: "1", path: "/" }],
    });
    assertEquals(
      Object.keys(carrier),
      [],
      "the error carrier must expose no enumerable metadata",
    );
    assertEquals(
      JSON.stringify(carrier),
      "{}",
      "cookie values must not serialize with the error",
    );
    assertEquals(
      JSON.stringify({ ...carrier }).includes("page-seen"),
      false,
      "spreading the error must not leak cookie names or values",
    );
  });
});

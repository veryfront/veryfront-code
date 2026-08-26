import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { csrfMutationHeadersFor } from "./browser-mutation-headers.ts";
import {
  csrfHttpsTokenCookieName,
  csrfHttpTokenCookieName,
  csrfNamesCookieName,
  DEFAULT_CSRF_COOKIE_NAME,
  DEFAULT_CSRF_HEADER_NAME,
} from "./names.ts";

const ORIGIN = "https://app.test";
const facts = (cookie: string) => ({ cookie, baseURI: `${ORIGIN}/page`, origin: ORIGIN });
const advertisedNames = (origin: string, value: string) =>
  `${csrfNamesCookieName(origin)}=${value}`;

describe("csrfMutationHeadersFor", () => {
  it("keeps configured names independent for applications on different ports", () => {
    const firstOrigin = "http://localhost:3000";
    const secondOrigin = "http://localhost:4000";
    const firstAdvertisement = csrfNamesCookieName(firstOrigin);
    const secondAdvertisement = csrfNamesCookieName(secondOrigin);
    const headers = csrfMutationHeadersFor(
      "/api/cases",
      {
        cookie: `${firstAdvertisement}=${firstOrigin}:vf_first:x-first; ` +
          `${secondAdvertisement}=${secondOrigin}:vf_second:x-second; ` +
          "vf_first=first-token; vf_second=second-token",
        baseURI: `${firstOrigin}/page`,
        origin: firstOrigin,
      },
    );

    assertEquals(headers.get("x-first"), "first-token");
    assertEquals(
      headers.get("x-second"),
      null,
      "a sibling application's advertisement must remain stored without affecting this origin",
    );
  });

  it("discovers configured names from the advertisement with no caller arguments", () => {
    const headers = csrfMutationHeadersFor(
      "/api/cases",
      facts(
        `${advertisedNames(ORIGIN, `${ORIGIN}:vf_project_csrf:x-project-csrf`)}; ` +
          "vf_project_csrf=tok-123",
      ),
    );

    assertEquals(
      headers.get("x-project-csrf"),
      "tok-123",
      "a configured project must work without repeating its names at the call site",
    );
    assertEquals(
      headers.get(DEFAULT_CSRF_HEADER_NAME),
      null,
      "the default header must not be sent when the project configured another",
    );
  });

  it("accepts an advertised origin-scoped HTTP token name", () => {
    const origin = "http://192.168.1.20:3000";
    const cookieName = csrfHttpTokenCookieName("vf_csrf", origin);
    const headers = csrfMutationHeadersFor(
      "/api/cases",
      {
        cookie: `${advertisedNames(origin, `${origin}:${cookieName}:x-project-csrf`)}; ` +
          `${cookieName}=tok-http`,
        baseURI: `${origin}/page`,
        origin,
      },
    );

    assertEquals(
      headers.get("x-project-csrf"),
      "tok-http",
      "a validated internal name from server discovery must not be treated as caller config",
    );
  });

  it("accepts an advertised origin-scoped HTTPS migration token", () => {
    const cookieName = csrfHttpsTokenCookieName("vf_csrf", ORIGIN);
    const headers = csrfMutationHeadersFor(
      "/api/cases",
      facts(
        `${advertisedNames(ORIGIN, `${ORIGIN}:${cookieName}:x-project-csrf`)}; ` +
          `${cookieName}=tok-https`,
      ),
    );

    assertEquals(
      headers.get("x-project-csrf"),
      "tok-https",
      "the HTTPS migration token must remain discoverable without caller configuration",
    );
  });

  it("recovers an HTTPS migration token for an explicit configured name", () => {
    const configuredName = "vf_explicit";
    const cookieName = csrfHttpsTokenCookieName(configuredName, ORIGIN);
    const headers = csrfMutationHeadersFor(
      "/api/cases",
      facts(`${cookieName}=tok-https`),
      { cookieName: configuredName, headerName: "x-explicit" },
    );

    assertEquals(
      headers.get("x-explicit"),
      "tok-https",
      "explicit configuration must retain deterministic migration discovery",
    );
  });

  it("round-trips percent characters from an encoded advertisement", () => {
    const headers = csrfMutationHeadersFor(
      "/api/cases",
      facts(
        `${csrfNamesCookieName(ORIGIN)}=` +
          "https%3A%2F%2Fapp.test%3Avf%252Eproject%252Ecsrf%3Ax-project-csrf; " +
          "vf%2Eproject%2Ecsrf=tok-123",
      ),
    );

    assertEquals(
      headers.get("x-project-csrf"),
      "tok-123",
      "the browser must recover the exact percent-bearing cookie name the server configured",
    );
  });

  it("uses the documented defaults when nothing is advertised", () => {
    const headers = csrfMutationHeadersFor(
      "/api/cases",
      facts(`${DEFAULT_CSRF_COOKIE_NAME}=tok-default`),
    );

    assertEquals(
      headers.get(DEFAULT_CSRF_HEADER_NAME),
      "tok-default",
      "a default project keeps working with no advertisement present",
    );
  });

  it("normalizes an explicit default cookie name for an insecure origin", () => {
    const origin = "http://app.test";
    const headers = csrfMutationHeadersFor(
      "/api/cases",
      {
        cookie: "vf_csrf=tok-insecure",
        baseURI: `${origin}/page`,
        origin,
      },
      { cookieName: DEFAULT_CSRF_COOKIE_NAME },
    );

    assertEquals(
      headers.get(DEFAULT_CSRF_HEADER_NAME),
      "tok-insecure",
      "the browser must use the same insecure-origin default as issuance and validation",
    );
  });

  it("lets an explicit caller name override the advertisement", () => {
    const headers = csrfMutationHeadersFor(
      "/api/cases",
      facts(
        `${advertisedNames(ORIGIN, `${ORIGIN}:vf_advertised:x-advertised`)}; ` +
          "vf_explicit=tok-explicit",
      ),
      { cookieName: "vf_explicit", headerName: "x-explicit" },
    );

    assertEquals(
      headers.get("x-explicit"),
      "tok-explicit",
      "an explicit caller name must win over discovery",
    );
    assertEquals(
      headers.get("x-advertised"),
      null,
      "the advertised header must not also be sent",
    );
  });

  it("keeps an explicit HTTP custom name compatible with an origin-scoped token", () => {
    const origin = "http://app.test";
    const cookieName = csrfHttpTokenCookieName("vf_explicit", origin);
    const headers = csrfMutationHeadersFor(
      "/api/cases",
      {
        cookie: `${cookieName}=tok-explicit`,
        baseURI: `${origin}/page`,
        origin,
      },
      { cookieName: "vf_explicit", headerName: "x-explicit" },
    );

    assertEquals(headers.get("x-explicit"), "tok-explicit");
  });

  it("recovers a derived HTTP default when its advertisement is missing", () => {
    const origin = "http://app.test";
    const cookieName = csrfHttpTokenCookieName("vf_csrf", origin);
    const headers = csrfMutationHeadersFor(
      "/api/cases",
      {
        cookie: `${cookieName}=tok-http`,
        baseURI: `${origin}/page`,
        origin,
      },
    );

    assertEquals(
      headers.get(DEFAULT_CSRF_HEADER_NAME),
      "tok-http",
      "evicting discovery must not strand an otherwise valid deterministic HTTP token",
    );
  });

  it("normalizes an explicit documented default for a plain HTTP origin", () => {
    const origin = "http://app.test";
    const headers = csrfMutationHeadersFor(
      "/api/cases",
      {
        cookie: `${advertisedNames(origin, `${origin}:vf_csrf:x-project-csrf`)}; ` +
          "vf_csrf=tok-http",
        baseURI: `${origin}/page`,
        origin,
      },
      { cookieName: DEFAULT_CSRF_COOKIE_NAME },
    );

    assertEquals(
      headers.get("x-project-csrf"),
      "tok-http",
      "the browser helper must match the effective name used by issuance and validation",
    );
  });

  it("falls back to defaults when the advertisement is malformed", () => {
    const headers = csrfMutationHeadersFor(
      "/api/cases",
      facts(
        `${advertisedNames(ORIGIN, "broken")}; ${DEFAULT_CSRF_COOKIE_NAME}=tok-default`,
      ),
    );

    assertEquals(
      headers.get(DEFAULT_CSRF_HEADER_NAME),
      "tok-default",
      "a malformed advertisement must not strand the request without a token",
    );
  });

  it("never sends the token across origins", () => {
    const headers = csrfMutationHeadersFor(
      "https://evil.test/api",
      facts(
        `${advertisedNames(ORIGIN, `${ORIGIN}:vf_project_csrf:x-project-csrf`)}; ` +
          "vf_project_csrf=tok-123",
      ),
    );

    assertEquals(
      headers.get("x-project-csrf"),
      null,
      "a discovered name must not widen the same-origin restriction",
    );
  });

  it("preserves a token the caller already attached", () => {
    const headers = csrfMutationHeadersFor(
      "/api/cases",
      facts(
        `${advertisedNames(ORIGIN, `${ORIGIN}:vf_project_csrf:x-project-csrf`)}; ` +
          "vf_project_csrf=tok-123",
      ),
      { headers: { "x-project-csrf": "caller-set" } },
    );

    assertEquals(
      headers.get("x-project-csrf"),
      "caller-set",
      "an explicit caller token must never be overwritten",
    );
  });

  it("rejects an invalid caller-supplied name instead of silently defaulting", () => {
    assertThrows(
      () => csrfMutationHeadersFor("/api/cases", facts(""), { headerName: "x bad" }),
      TypeError,
      "CSRF headerName",
      "an invalid configured name must fail loudly rather than send the default header",
    );
  });

  it("rejects an explicit cookie name in the advertisement namespace", () => {
    assertThrows(
      () =>
        csrfMutationHeadersFor("/api/cases", facts(""), {
          cookieName: csrfNamesCookieName(ORIGIN),
        }),
      TypeError,
      "reserved",
      "an explicit browser override must obey the same reservation as server configuration",
    );
  });

  it("accepts a non-derived cookie name that only shares the advertisement prefix", () => {
    const cookieName = "vf_csrf_names_forbidden";
    const headers = csrfMutationHeadersFor(
      "/api/cases",
      facts(`${cookieName}=matching-token`),
      { cookieName },
    );

    assertEquals(headers.get(DEFAULT_CSRF_HEADER_NAME), "matching-token");
  });

  it("ignores an advertisement written by a sibling app on another port", () => {
    const headers = csrfMutationHeadersFor(
      "/api/cases",
      facts(
        `${
          advertisedNames(
            "https://app.test:9999",
            "https://app.test:9999:vf_other:x-other",
          )
        }; ` +
          `${DEFAULT_CSRF_COOKIE_NAME}=tok-default`,
      ),
    );

    assertEquals(
      headers.get("x-other"),
      null,
      "a sibling project sharing the host must not redirect our CSRF header",
    );
    assertEquals(
      headers.get(DEFAULT_CSRF_HEADER_NAME),
      "tok-default",
      "the foreign advertisement must fall back to this project's defaults",
    );
  });
});

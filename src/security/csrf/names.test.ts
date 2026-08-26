import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  CSRF_NAMES_COOKIE_NAME,
  csrfNamesCookieName,
  decodeCsrfNamesAdvertisement,
  DEFAULT_CSRF_COOKIE_NAME,
  DEFAULT_CSRF_HEADER_NAME,
  encodeCsrfNamesAdvertisement,
  requireNonReservedCsrfCookieName,
} from "./names.ts";

const ORIGIN = "https://app.test";

describe("security/csrf/names advertisement", () => {
  it("gives each origin its own advertisement cookie", () => {
    const first = csrfNamesCookieName("http://localhost:3000");
    const second = csrfNamesCookieName("http://localhost:4000");

    assertEquals(first.startsWith(`${CSRF_NAMES_COOKIE_NAME}_`), true);
    assertEquals(second.startsWith(`${CSRF_NAMES_COOKIE_NAME}_`), true);
    assertEquals(
      first === second,
      false,
      "applications on different ports must not overwrite each other's configured names",
    );
  });

  it("omits the advertisement when both names are the documented defaults", () => {
    assertEquals(
      encodeCsrfNamesAdvertisement(DEFAULT_CSRF_COOKIE_NAME, DEFAULT_CSRF_HEADER_NAME, ORIGIN),
      null,
      "a default project must not receive an extra cookie it cannot use",
    );
  });

  it("advertises whenever either name is configured away from the default", () => {
    assertEquals(
      encodeCsrfNamesAdvertisement("vf_project_csrf", DEFAULT_CSRF_HEADER_NAME, ORIGIN),
      `${ORIGIN}:vf_project_csrf:${DEFAULT_CSRF_HEADER_NAME}`,
      "a configured cookie name alone must still be advertised",
    );
    assertEquals(
      encodeCsrfNamesAdvertisement(DEFAULT_CSRF_COOKIE_NAME, "x-project-csrf", ORIGIN),
      `${ORIGIN}:${DEFAULT_CSRF_COOKIE_NAME}:x-project-csrf`,
      "a configured header name alone must still be advertised",
    );
  });

  it("round-trips a configured pair for the document's own origin", () => {
    const encoded = encodeCsrfNamesAdvertisement("vf_project_csrf", "x-project-csrf", ORIGIN);
    assertEquals(
      decodeCsrfNamesAdvertisement(encoded ?? undefined, ORIGIN),
      { cookieName: "vf_project_csrf", headerName: "x-project-csrf" },
      "the helper must recover exactly the names the server published",
    );
  });

  it("keeps names containing a period unambiguous", () => {
    const encoded = encodeCsrfNamesAdvertisement("vf.project.csrf", "x.project.csrf", ORIGIN);
    assertEquals(
      decodeCsrfNamesAdvertisement(encoded ?? undefined, ORIGIN),
      { cookieName: "vf.project.csrf", headerName: "x.project.csrf" },
      "a period is a legal HTTP token character, so it must not split the pair",
    );
  });

  it("ignores an advertisement published by another origin on the same host", () => {
    const encoded = encodeCsrfNamesAdvertisement(
      "vf_other_csrf",
      "x-other-csrf",
      "http://localhost:4321",
    );
    assertEquals(
      decodeCsrfNamesAdvertisement(encoded ?? undefined, "http://localhost:1234"),
      null,
      "cookies are shared across ports, so a sibling project must not redirect our header",
    );
  });

  it("refuses to advertise a cookie name reserved for the advertisement itself", () => {
    assertThrows(
      () => encodeCsrfNamesAdvertisement(CSRF_NAMES_COOKIE_NAME, "x-csrf-token", ORIGIN),
      TypeError,
      "reserved",
      "reusing the advertisement name would overwrite the random token cookie",
    );
    assertThrows(
      () => requireNonReservedCsrfCookieName(CSRF_NAMES_COOKIE_NAME),
      TypeError,
      "reserved",
      "the reservation must be enforceable wherever a cookie name is resolved",
    );
    assertThrows(
      () => requireNonReservedCsrfCookieName(csrfNamesCookieName(ORIGIN)),
      TypeError,
      "reserved",
      "a configured token must not collide with an origin-specific advertisement cookie",
    );
  });

  it("rejects malformed advertisements instead of half-applying them", () => {
    for (
      const [value, why] of [
        [undefined, "absent cookie"],
        ["", "empty value"],
        ["vf_only", "no separator"],
        [`${ORIGIN}:vf_project_csrf`, "missing header half"],
        [`${ORIGIN}::x-csrf-token`, "empty cookie half"],
        [`${ORIGIN}:vf_project_csrf:`, "empty header half"],
        [`${ORIGIN}:vf bad:x-csrf-token`, "cookie half is not an HTTP token"],
        [`${ORIGIN}:vf_project_csrf:x csrf`, "header half is not an HTTP token"],
        [`${ORIGIN}:${CSRF_NAMES_COOKIE_NAME}:x-csrf-token`, "reserved cookie name"],
      ] as const
    ) {
      assertEquals(
        decodeCsrfNamesAdvertisement(value, ORIGIN),
        null,
        `${why} must fall back to the defaults rather than produce a half-configured request`,
      );
    }
  });
  it("advertises for an IPv6 origin whose host contains colons", () => {
    const ipv6 = "http://[::1]:3000";
    const encoded = encodeCsrfNamesAdvertisement("vf_project_csrf", "x-project-csrf", ipv6);
    assertEquals(
      decodeCsrfNamesAdvertisement(encoded ?? undefined, ipv6),
      { cookieName: "vf_project_csrf", headerName: "x-project-csrf" },
      "an IPv6 origin must still get discovery: decoding splits from the right",
    );
  });
});

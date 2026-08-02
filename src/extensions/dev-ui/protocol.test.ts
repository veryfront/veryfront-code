import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { DASHBOARD_SESSION_PATH, getDashboardSessionCookieName } from "./protocol.ts";

describe("development UI protocol", () => {
  it("derives a distinct, deterministic dashboard cookie name per listener port", () => {
    assertEquals(getDashboardSessionCookieName(80), "vf_dashboard_session_80");
    assertEquals(getDashboardSessionCookieName(3000), "vf_dashboard_session_3000");
    assertEquals(getDashboardSessionCookieName(3001), "vf_dashboard_session_3001");
  });

  it("rejects non-canonical listener ports", () => {
    for (const port of [0, -1, 1.5, 65_536, Number.NaN, Number.POSITIVE_INFINITY]) {
      assertThrows(
        () => getDashboardSessionCookieName(port),
        RangeError,
        "integer from 1 to 65535",
      );
    }
  });

  it("publishes one headless session bootstrap path", () => {
    assertEquals(DASHBOARD_SESSION_PATH, "/_dev/session");
  });
});

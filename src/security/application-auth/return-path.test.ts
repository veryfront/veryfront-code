import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parseApplicationAuthReturnPath } from "./return-path.ts";

describe("security/application-auth return-path", () => {
  it("accepts app-relative path and query values and returns canonical path plus query", () => {
    assertEquals(parseApplicationAuthReturnPath("/dashboard"), "/dashboard");
    assertEquals(
      parseApplicationAuthReturnPath("/dashboard?tab=members&sort=asc"),
      "/dashboard?tab=members&sort=asc",
    );
    assertEquals(parseApplicationAuthReturnPath("/a/../b?x=1"), "/b?x=1");
  });

  it("rejects absolute, scheme-relative, credentialed, and non-single-slash values", () => {
    for (
      const value of [
        "https://app.example.com/dashboard",
        "//app.example.com/dashboard",
        "https://user:pass@app.example.com/dashboard",
        "dashboard",
        "",
      ]
    ) {
      assertThrows(() => parseApplicationAuthReturnPath(value), TypeError, "return path");
    }
  });

  it("rejects fragments, backslashes, control characters, invalid encoding, and oversized values", () => {
    for (
      const value of [
        "/dashboard#section",
        "/dash\\board",
        "/dashboard%5csettings",
        "/dashboard%255csettings",
        "/dashboard%0asettings",
        "/dashboard%250asettings",
        "/dashboard\nsettings",
        "/dashboard%E0%A4%A",
        "/%2fevil.example.com/dashboard",
        "/%252fevil.example.com/dashboard",
        `/${"a".repeat(2_048)}`,
      ]
    ) {
      assertThrows(() => parseApplicationAuthReturnPath(value), TypeError, "return path");
    }
  });

  it("rejects auth route loops after repeated decoding and URL resolution", () => {
    for (
      const value of [
        "/_veryfront/auth",
        "/_veryfront/auth/callback",
        "/%5fveryfront/auth",
        "/%255fveryfront/auth/callback",
        "/safe/../_veryfront/auth",
      ]
    ) {
      assertThrows(() => parseApplicationAuthReturnPath(value), TypeError, "return path");
    }
  });

  it("rejects non-string boundary inputs", () => {
    assertThrows(() => parseApplicationAuthReturnPath(null), TypeError, "return path");
    assertThrows(
      () => parseApplicationAuthReturnPath({ path: "/dashboard" }),
      TypeError,
      "return path",
    );
  });
});

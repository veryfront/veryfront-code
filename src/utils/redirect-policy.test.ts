import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  isRedirectDestinationAllowed,
  isValidRedirectOriginList,
  parseCanonicalRedirectOrigin,
} from "./redirect-policy.ts";

describe("redirect policy", () => {
  it("accepts only canonical HTTP(S) origins", () => {
    assertEquals(
      parseCanonicalRedirectOrigin("https://accounts.example.com"),
      "https://accounts.example.com",
    );
    assertEquals(parseCanonicalRedirectOrigin("http://localhost:3000"), "http://localhost:3000");

    for (
      const value of [
        "https://accounts.example.com/",
        "https://accounts.example.com/path",
        "https://accounts.example.com?tenant=one",
        "https://user:password@accounts.example.com",
        "javascript:",
        "//accounts.example.com",
      ]
    ) {
      assertEquals(parseCanonicalRedirectOrigin(value), null);
    }
  });

  it("rejects duplicate and invalid allowlist entries", () => {
    assertEquals(isValidRedirectOriginList([]), true);
    assertEquals(
      isValidRedirectOriginList(["https://accounts.example.com"]),
      true,
    );
    assertEquals(
      isValidRedirectOriginList([
        "https://accounts.example.com",
        "https://accounts.example.com",
      ]),
      false,
    );
    assertEquals(isValidRedirectOriginList(["data:text/plain,blocked"]), false);
  });

  it("enforces exact request and allowlisted origins", () => {
    const requestUrl = "https://app.example.com/account";
    const policy = { allowedOrigins: ["https://accounts.example.com"] };

    for (
      const destination of [
        "/login",
        "https://app.example.com/login",
        "https://accounts.example.com/login",
      ]
    ) {
      assertEquals(isRedirectDestinationAllowed(destination, requestUrl, policy), true);
    }

    for (
      const destination of [
        "http://app.example.com/login",
        "https://app.example.com:444/login",
        "https://untrusted.example/login",
        "javascript:alert(1)",
        " https://app.example.com/login",
      ]
    ) {
      assertEquals(isRedirectDestinationAllowed(destination, requestUrl, policy), false);
    }
  });

  it("preserves unrestricted redirects only when the policy is omitted", () => {
    assertEquals(
      isRedirectDestinationAllowed(
        "https://untrusted.example/login",
        "https://app.example.com/account",
        undefined,
      ),
      true,
    );
    assertEquals(
      isRedirectDestinationAllowed(
        "https://untrusted.example/login",
        "https://app.example.com/account",
        null,
      ),
      false,
    );
  });
});

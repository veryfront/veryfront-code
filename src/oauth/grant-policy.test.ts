import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

import { isSupersededOAuthGrant } from "./grant-policy.ts";
import type { OAuthTokens } from "./types.ts";

describe("isSupersededOAuthGrant", () => {
  it("reads scope and scopeSource only from own data properties", () => {
    const inherited = Object.create({
      get scope() {
        throw new Error("scope getter must not run");
      },
      get scopeSource() {
        throw new Error("scopeSource getter must not run");
      },
    }) as OAuthTokens;
    Object.defineProperty(inherited, "accessToken", {
      configurable: true,
      enumerable: true,
      value: "token",
      writable: true,
    });

    assertEquals(isSupersededOAuthGrant("drive", inherited), false);
  });

  it("does not trust inherited explicit scope provenance", () => {
    const inheritedExplicit = Object.create({
      scopeSource: "explicit",
    }) as OAuthTokens;
    Object.defineProperties(inheritedExplicit, {
      accessToken: {
        configurable: true,
        enumerable: true,
        value: "token",
        writable: true,
      },
      scope: {
        configurable: true,
        enumerable: true,
        value: "https://www.googleapis.com/auth/drive",
        writable: true,
      },
    });

    assertEquals(isSupersededOAuthGrant("drive", inheritedExplicit), true);
  });
});

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

import { isSupersededOAuthGrant } from "./grant-policy.ts";
import type { OAuthTokens } from "./types.ts";

describe("isSupersededOAuthGrant", () => {
  const fullDriveScope = "https://www.googleapis.com/auth/drive";
  const narrowedDriveScopes = [
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/drive.file",
  ];

  it("does not reserve a built-in service ID for a custom broad config", () => {
    assertEquals(
      isSupersededOAuthGrant(
        "drive",
        { accessToken: "token", scope: fullDriveScope },
        [fullDriveScope],
      ),
      false,
    );
  });

  it("rejects a broad response to an explicit narrow request", () => {
    assertEquals(
      isSupersededOAuthGrant(
        "drive",
        {
          accessToken: "token",
          scope: fullDriveScope,
          scopeSource: "explicit",
          requestedScope: narrowedDriveScopes.join(" "),
        } as OAuthTokens & { requestedScope: string },
        narrowedDriveScopes,
      ),
      true,
    );
  });

  it("checks explicit requests even when custom defaults are broad", () => {
    assertEquals(
      isSupersededOAuthGrant(
        "drive",
        {
          accessToken: "token",
          scope: fullDriveScope,
          scopeSource: "explicit",
          requestedScope: narrowedDriveScopes.join(" "),
        } as OAuthTokens & { requestedScope: string },
        [fullDriveScope],
      ),
      true,
    );
  });

  it("preserves a broad scope only when that exact scope was explicitly requested", () => {
    assertEquals(
      isSupersededOAuthGrant(
        "drive",
        {
          accessToken: "token",
          scope: fullDriveScope,
          scopeSource: "explicit",
          requestedScope: fullDriveScope,
        } as OAuthTokens & { requestedScope: string },
        narrowedDriveScopes,
      ),
      false,
    );
  });

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

    assertEquals(isSupersededOAuthGrant("drive", inherited, narrowedDriveScopes), false);
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

    assertEquals(isSupersededOAuthGrant("drive", inheritedExplicit, narrowedDriveScopes), true);
  });
});

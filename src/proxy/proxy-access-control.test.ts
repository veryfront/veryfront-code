import { assertEquals } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import {
  buildProxyAuthRedirectUrl,
  checkProtectedProxyAccess,
  isProjectMember,
} from "./proxy-access-control.ts";

describe("proxy/proxy-access-control", () => {
  it("builds sign-in redirect URLs without allowing protocol-relative return paths", () => {
    assertEquals(
      buildProxyAuthRedirectUrl(new URL("https://app.preview.veryfront.com//evil.com?a=1")),
      "https://veryfront.com/sign-in?from=%2Fevil.com%3Fa%3D1",
    );
    assertEquals(
      buildProxyAuthRedirectUrl(new URL("https://app.production.veryfront.com/dashboard?a=1")),
      "https://veryfront.com/sign-in?from=https%3A%2F%2Fapp.production.veryfront.com%2Fdashboard%3Fa%3D1",
    );
  });

  it("checks project membership by user id", () => {
    assertEquals(isProjectMember([{ id: "user-1" }], "user-1"), true);
    assertEquals(isProjectMember([{ id: "user-1" }], "user-2"), false);
    assertEquals(isProjectMember(undefined, "user-1"), false);
    assertEquals(isProjectMember([{ id: "user-1" }], undefined), false);
  });

  it("allows unprotected and signed internal requests without user token checks", async () => {
    const req = new Request("https://app.preview.veryfront.com/");
    const url = new URL(req.url);
    let extractCalls = 0;
    const extractUserId = () => {
      extractCalls += 1;
      return Promise.resolve(undefined);
    };

    assertEquals(
      await checkProtectedProxyAccess({
        req,
        url,
        matchingEnv: { name: "preview", protected: false },
        userToken: undefined,
        users: undefined,
        apiBaseUrl: "https://api.example.com",
        isSignedInternalControlPlaneRequest: false,
        extractUserIdFromToken: extractUserId,
      }),
      null,
    );
    assertEquals(
      await checkProtectedProxyAccess({
        req,
        url,
        matchingEnv: { name: "preview", protected: true },
        userToken: undefined,
        users: undefined,
        apiBaseUrl: "https://api.example.com",
        isSignedInternalControlPlaneRequest: true,
        extractUserIdFromToken: extractUserId,
      }),
      null,
    );
    assertEquals(extractCalls, 0);
  });

  it("classifies missing, unverified, non-member, and member access", async () => {
    const req = new Request("https://app.preview.veryfront.com/dashboard");
    const url = new URL(req.url);
    const matchingEnv = { name: "preview", protected: true };

    assertEquals(
      await checkProtectedProxyAccess({
        req,
        url,
        matchingEnv,
        userToken: undefined,
        users: [{ id: "user-1" }],
        apiBaseUrl: "https://api.example.com",
        isSignedInternalControlPlaneRequest: false,
        extractUserIdFromToken: () => Promise.resolve("user-1"),
      }),
      {
        status: 302,
        message: "Authentication required",
        redirectUrl: "https://veryfront.com/sign-in?from=%2Fdashboard",
      },
    );

    assertEquals(
      await checkProtectedProxyAccess({
        req,
        url,
        matchingEnv,
        userToken: "invalid-token",
        users: [{ id: "user-1" }],
        apiBaseUrl: "https://api.example.com",
        isSignedInternalControlPlaneRequest: false,
        extractUserIdFromToken: () => Promise.resolve(undefined),
      }),
      {
        status: 302,
        message: "Authentication required",
        redirectUrl: "https://veryfront.com/sign-in?from=%2Fdashboard",
      },
    );

    assertEquals(
      await checkProtectedProxyAccess({
        req,
        url,
        matchingEnv,
        userToken: "user-token",
        users: [{ id: "user-1" }],
        apiBaseUrl: "https://api.example.com",
        isSignedInternalControlPlaneRequest: false,
        extractUserIdFromToken: () => Promise.resolve("user-2"),
      }),
      { status: 403, message: "Access denied" },
    );

    assertEquals(
      await checkProtectedProxyAccess({
        req,
        url,
        matchingEnv,
        userToken: "user-token",
        users: [{ id: "user-1" }],
        apiBaseUrl: "https://api.example.com",
        isSignedInternalControlPlaneRequest: false,
        extractUserIdFromToken: () => Promise.resolve("user-1"),
      }),
      null,
    );
  });
});

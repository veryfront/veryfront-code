import { assertEquals } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import {
  buildProxyAuthRedirectUrl,
  checkProtectedProxyAccess,
  extractUserIdFromToken,
  isProjectMember,
} from "./proxy-access-control.ts";
import { register, reset } from "../extensions/contracts.ts";
import type { AuthProvider } from "../extensions/auth/index.ts";

function createAuthProvider(userId: string): AuthProvider {
  const payload = { sub: userId, userId };
  return {
    sign: () => Promise.resolve("signed"),
    verify: () => Promise.resolve(payload),
    verifyWithJwks: () => Promise.resolve(payload),
    verifyWithPublicKey: () => Promise.resolve(payload),
    decode: () => ({ alg: "HS256" }),
  };
}

describe("proxy/proxy-access-control", () => {
  it("resolves the current AuthProvider contract after registry replacement", async () => {
    const previousSecret = Deno.env.get("JWT_SECRET");
    Deno.env.set("JWT_SECRET", "test-secret");
    try {
      register<AuthProvider>("AuthProvider", createAuthProvider("first-user"));
      assertEquals(
        await extractUserIdFromToken(
          "first-token",
          "https://api.example.com",
        ),
        "first-user",
      );

      register<AuthProvider>("AuthProvider", createAuthProvider("second-user"));
      assertEquals(
        await extractUserIdFromToken(
          "second-token",
          "https://api.example.com",
        ),
        "second-user",
      );
    } finally {
      reset();
      if (previousSecret === undefined) Deno.env.delete("JWT_SECRET");
      else Deno.env.set("JWT_SECRET", previousSecret);
    }
  });

  it("contains decode failures and never invokes verified payload accessors", async () => {
    let userIdReads = 0;
    const provider = createAuthProvider("unused");
    provider.decode = () => {
      throw new Error("malformed token");
    };
    register<AuthProvider>("AuthProvider", provider);
    assertEquals(
      await extractUserIdFromToken("bad-token", "https://api.example.com"),
      undefined,
    );

    provider.decode = () => ({ alg: "HS256" });
    provider.verify = () => {
      const payload = { sub: "user" };
      Object.defineProperty(payload, "userId", {
        enumerable: true,
        get() {
          userIdReads += 1;
          return "attacker";
        },
      });
      return Promise.resolve(payload);
    };
    const previousSecret = Deno.env.get("JWT_SECRET");
    Deno.env.set("JWT_SECRET", "test-secret");
    try {
      assertEquals(
        await extractUserIdFromToken("token", "https://api.example.com"),
        undefined,
      );
      assertEquals(userIdReads, 0);
    } finally {
      reset();
      if (previousSecret === undefined) Deno.env.delete("JWT_SECRET");
      else Deno.env.set("JWT_SECRET", previousSecret);
    }
  });

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

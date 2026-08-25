import { assertEquals } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import {
  buildProxyAuthRedirectUrl,
  checkProtectedProxyAccess,
  extractUserIdFromToken,
  isProjectMember,
  toProxyPrincipal,
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

  it("signs in on the apex the request arrived on", () => {
    // Sending a staging visitor to veryfront.com mints a cookie for a domain
    // that a veryfront.org host never receives, so the redirect loop cannot
    // close and staging previews stay unreachable while signed in.
    assertEquals(
      buildProxyAuthRedirectUrl(new URL("https://app.preview.veryfront.org/dashboard?a=1")),
      "https://veryfront.org/sign-in?from=%2Fdashboard%3Fa%3D1",
    );
    // Production-mode deployments keep the default apex, unchanged since #1827.
    assertEquals(
      buildProxyAuthRedirectUrl(
        new URL("https://app.production.veryfront.org/dashboard?a=1"),
      ),
      "https://veryfront.com/sign-in?from=https%3A%2F%2Fapp.production.veryfront.org%2Fdashboard%3Fa%3D1",
    );
    assertEquals(
      buildProxyAuthRedirectUrl(new URL("https://veryfront.org/dashboard")),
      "https://veryfront.org/sign-in?from=%2Fdashboard",
    );
  });

  it("never takes the sign-in host from an unrecognized request host", () => {
    // The apex is chosen from a fixed allowlist, so a forged Host header cannot
    // point the sign-in redirect off-platform.
    for (
      const hostname of [
        "evil.com",
        "veryfront.org.evil.com",
        "notveryfront.org",
        "app.preview.veryfront.io",
      ]
    ) {
      assertEquals(
        buildProxyAuthRedirectUrl(new URL(`https://${hostname}/dashboard`)),
        "https://veryfront.com/sign-in?from=%2Fdashboard",
      );
    }
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
        extractPrincipal: extractUserId,
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
        extractPrincipal: extractUserId,
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
        extractPrincipal: () => Promise.resolve({ userId: "user-1" }),
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
        extractPrincipal: () => Promise.resolve(undefined),
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
        extractPrincipal: () => Promise.resolve({ userId: "user-2" }),
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
        extractPrincipal: () => Promise.resolve({ userId: "user-1" }),
      }),
      null,
    );
  });
});

describe("environment access tokens at the gate", () => {
  const req = new Request("https://app.preview.veryfront.com/dashboard");
  const url = new URL(req.url);
  const matchingEnv = { id: "env-1", name: "preview", protected: true };
  const bound = {
    userId: "user-1",
    environmentAccess: { projectId: "project-1", environmentId: "env-1" },
  };

  it("maps a verified payload to a principal, requiring audience and use for a bound token", () => {
    assertEquals(toProxyPrincipal({ userId: "user-1" }), { userId: "user-1" });
    assertEquals(
      toProxyPrincipal({
        userId: "user-1",
        aud: "environment-gate",
        tokenUse: "environment_access",
        projectId: "project-1",
        environmentId: "env-1",
      }),
      bound,
    );
    // A token that names the use but not the audience, or the other way round,
    // or that is bound to nothing, is not a credential this gate issued for.
    assertEquals(
      toProxyPrincipal({
        userId: "user-1",
        tokenUse: "environment_access",
        projectId: "project-1",
      }),
      undefined,
    );
    assertEquals(
      toProxyPrincipal({ userId: "user-1", aud: "environment-gate", projectId: "project-1" }),
      undefined,
    );
    assertEquals(
      toProxyPrincipal({
        userId: "user-1",
        aud: "environment-gate",
        tokenUse: "environment_access",
      }),
      undefined,
    );
    assertEquals(
      toProxyPrincipal({ aud: "environment-gate", tokenUse: "environment_access" }),
      undefined,
    );
  });

  it("admits a bound token only for the project and environment it names", async () => {
    const base = {
      url,
      matchingEnv,
      projectId: "project-1",
      userToken: "environment-token",
      users: [{ id: "user-1" }],
      apiBaseUrl: "https://api.example.com",
      isSignedInternalControlPlaneRequest: false,
    };

    assertEquals(
      await checkProtectedProxyAccess({ ...base, extractPrincipal: () => Promise.resolve(bound) }),
      null,
    );
    assertEquals(
      await checkProtectedProxyAccess({
        ...base,
        projectId: "project-2",
        extractPrincipal: () => Promise.resolve(bound),
      }),
      { status: 403, message: "Access denied" },
    );
    assertEquals(
      await checkProtectedProxyAccess({
        ...base,
        matchingEnv: { id: "env-2", name: "preview", protected: true },
        extractPrincipal: () => Promise.resolve(bound),
      }),
      { status: 403, message: "Access denied" },
    );
    // Membership is still the owner's: a bound token for a non-member is refused.
    assertEquals(
      await checkProtectedProxyAccess({
        ...base,
        users: [{ id: "user-2" }],
        extractPrincipal: () => Promise.resolve(bound),
      }),
      { status: 403, message: "Access denied" },
    );
  });
  it("requires both bindings on the token and a known environment at the gate", async () => {
    // A token naming only the project is not a credential this gate issued.
    assertEquals(
      toProxyPrincipal({
        userId: "user-1",
        aud: "environment-gate",
        tokenUse: "environment_access",
        projectId: "project-1",
      }),
      undefined,
    );
    // An environment the proxy cannot identify fails closed.
    assertEquals(
      await checkProtectedProxyAccess({
        url,
        matchingEnv: { name: "preview", protected: true },
        projectId: "project-1",
        userToken: "environment-token",
        users: [{ id: "user-1" }],
        apiBaseUrl: "https://api.example.com",
        isSignedInternalControlPlaneRequest: false,
        extractPrincipal: () => Promise.resolve(bound),
      }),
      { status: 403, message: "Access denied" },
    );
  });
});

import { assertEquals, assertThrows } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import {
  buildProxyAuthRedirectUrl,
  checkProtectedProxyAccess,
  createProxyAuthRedirectBuilder,
  extractUserIdFromToken,
  isProjectMember,
  toProxyPrincipal,
} from "./proxy-access-control.ts";
import { register, reset } from "../extensions/contracts.ts";
import type { AuthProvider } from "../extensions/auth/index.ts";

/** Create a deterministic auth provider for proxy access-control tests. */
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
  it("uses a configured customer sign-in origin and a bound project return URL", () => {
    const previous = Deno.env.get("VERYFRONT_PROXY_SIGN_IN_ORIGIN");
    Deno.env.set("VERYFRONT_PROXY_SIGN_IN_ORIGIN", "https://platform.example.test");
    try {
      assertEquals(
        createProxyAuthRedirectBuilder(Deno.env.get("VERYFRONT_PROXY_SIGN_IN_ORIGIN"))(
          new URL("http://app.production.platform.example.test/dashboard?a=1"),
        ),
        "https://platform.example.test/sign-in?from=https%3A%2F%2Fapp.production.platform.example.test%2Fdashboard%3Fa%3D1",
      );
      for (
        const host of ["evil.test", "platform.example.test.evil.test", "notplatform.example.test"]
      ) {
        assertEquals(
          createProxyAuthRedirectBuilder(Deno.env.get("VERYFRONT_PROXY_SIGN_IN_ORIGIN"))(
            new URL(`https://${host}//evil.test?a=1`),
          ),
          "https://platform.example.test/sign-in?from=%2Fevil.test%3Fa%3D1",
        );
      }
    } finally {
      if (previous === undefined) Deno.env.delete("VERYFRONT_PROXY_SIGN_IN_ORIGIN");
      else Deno.env.set("VERYFRONT_PROXY_SIGN_IN_ORIGIN", previous);
    }
  });

  it("binds customer return ports to configuration and removes request credentials", () => {
    const previous = Deno.env.get("VERYFRONT_PROXY_SIGN_IN_ORIGIN");
    Deno.env.set("VERYFRONT_PROXY_SIGN_IN_ORIGIN", "https://platform.example.test:8443/");
    try {
      assertEquals(
        createProxyAuthRedirectBuilder(Deno.env.get("VERYFRONT_PROXY_SIGN_IN_ORIGIN"))(
          new URL("http://user:pass@app.production.platform.example.test:9999//evil.test?a=1"),
        ),
        "https://platform.example.test:8443/sign-in?from=https%3A%2F%2Fapp.production.platform.example.test%3A8443%2Fevil.test%3Fa%3D1",
      );
    } finally {
      if (previous === undefined) Deno.env.delete("VERYFRONT_PROXY_SIGN_IN_ORIGIN");
      else Deno.env.set("VERYFRONT_PROXY_SIGN_IN_ORIGIN", previous);
    }
  });

  it("accepts canonical-equivalent configured HTTPS origins", () => {
    const previous = Deno.env.get("VERYFRONT_PROXY_SIGN_IN_ORIGIN");
    try {
      for (
        const origin of [
          "https://PLATFORM.EXAMPLE.TEST",
          "https://platform.example.test:443",
          "https://PLATFORM.EXAMPLE.TEST:443/",
        ]
      ) {
        Deno.env.set("VERYFRONT_PROXY_SIGN_IN_ORIGIN", origin);
        assertEquals(
          createProxyAuthRedirectBuilder(Deno.env.get("VERYFRONT_PROXY_SIGN_IN_ORIGIN"))(
            new URL("https://app.platform.example.test/"),
          ),
          "https://platform.example.test/sign-in?from=https%3A%2F%2Fapp.platform.example.test%2F",
        );
      }
    } finally {
      if (previous === undefined) Deno.env.delete("VERYFRONT_PROXY_SIGN_IN_ORIGIN");
      else Deno.env.set("VERYFRONT_PROXY_SIGN_IN_ORIGIN", previous);
    }
  });

  it("normalizes DNS root dots before trusting customer return hostnames", () => {
    const previous = Deno.env.get("VERYFRONT_PROXY_SIGN_IN_ORIGIN");
    try {
      for (const origin of ["https://platform.example.test", "https://platform.example.test."]) {
        Deno.env.set("VERYFRONT_PROXY_SIGN_IN_ORIGIN", origin);
        assertEquals(
          createProxyAuthRedirectBuilder(Deno.env.get("VERYFRONT_PROXY_SIGN_IN_ORIGIN"))(
            new URL("https://app.platform.example.test./dashboard"),
          ),
          "https://platform.example.test/sign-in?from=https%3A%2F%2Fapp.platform.example.test%2Fdashboard",
        );
        assertEquals(
          createProxyAuthRedirectBuilder(Deno.env.get("VERYFRONT_PROXY_SIGN_IN_ORIGIN"))(
            new URL("https://platform.example.test.evil.test./dashboard"),
          ),
          "https://platform.example.test/sign-in?from=%2Fdashboard",
        );
      }
    } finally {
      if (previous === undefined) Deno.env.delete("VERYFRONT_PROXY_SIGN_IN_ORIGIN");
      else Deno.env.set("VERYFRONT_PROXY_SIGN_IN_ORIGIN", previous);
    }
  });

  it("keeps configured-origin host trust stable after String.prototype.endsWith is patched", () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(String.prototype, "endsWith");
    const buildRedirect = createProxyAuthRedirectBuilder("https://platform.example.test");
    try {
      Object.defineProperty(String.prototype, "endsWith", {
        configurable: true,
        writable: true,
        value: () => true,
      });

      assertEquals(
        buildRedirect(new URL("https://platform.example.test.evil.test/dashboard")),
        "https://platform.example.test/sign-in?from=%2Fdashboard",
      );
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(String.prototype, "endsWith", originalDescriptor);
      } else {
        delete (String.prototype as { endsWith?: unknown }).endsWith;
      }
    }
  });

  it("keeps configured-origin return hosts primitive after String.prototype.toLowerCase is patched", () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(String.prototype, "toLowerCase");
    const coercedHost = {
      conversions: 0,
      toString() {
        this.conversions += 1;
        return this.conversions === 1 ? "app.platform.example.test" : "outside.example.test";
      },
    };
    const buildRedirect = createProxyAuthRedirectBuilder("https://platform.example.test");
    try {
      Object.defineProperty(String.prototype, "toLowerCase", {
        configurable: true,
        writable: true,
        value: () => coercedHost,
      });

      assertEquals(
        buildRedirect(new URL("https://app.platform.example.test/dashboard")),
        "https://platform.example.test/sign-in?from=https%3A%2F%2Fapp.platform.example.test%2Fdashboard",
      );
      assertEquals(coercedHost.conversions, 0);
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(String.prototype, "toLowerCase", originalDescriptor);
      } else {
        delete (String.prototype as { toLowerCase?: unknown }).toLowerCase;
      }
    }
  });

  it("keeps configured-origin return encoding stable after encodeURIComponent is patched", () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "encodeURIComponent");
    const buildRedirect = createProxyAuthRedirectBuilder("https://platform.example.test");
    try {
      Object.defineProperty(globalThis, "encodeURIComponent", {
        configurable: true,
        writable: true,
        value: () => "https://outside.example.test/",
      });

      assertEquals(
        buildRedirect(new URL("https://app.platform.example.test/dashboard")),
        "https://platform.example.test/sign-in?from=https%3A%2F%2Fapp.platform.example.test%2Fdashboard",
      );
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(globalThis, "encodeURIComponent", originalDescriptor);
      }
    }
  });

  it("rejects unsafe configured sign-in origins", () => {
    const previous = Deno.env.get("VERYFRONT_PROXY_SIGN_IN_ORIGIN");
    try {
      for (
        const origin of [
          "http://platform.example.test",
          "https://user:pass@platform.example.test",
          "https://platform.example.test/path",
          "https://platform.example.test?next=evil",
          "https://platform.example.test#fragment",
          "not-a-url",
        ]
      ) {
        Deno.env.set("VERYFRONT_PROXY_SIGN_IN_ORIGIN", origin);
        assertThrows(() =>
          createProxyAuthRedirectBuilder(Deno.env.get("VERYFRONT_PROXY_SIGN_IN_ORIGIN"))(
            new URL("https://app.platform.example.test/"),
          )
        );
      }
    } finally {
      if (previous === undefined) Deno.env.delete("VERYFRONT_PROXY_SIGN_IN_ORIGIN");
      else Deno.env.set("VERYFRONT_PROXY_SIGN_IN_ORIGIN", previous);
    }
  });

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

  it("keeps origin-form path normalization stable after String.prototype.slice is patched", () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(String.prototype, "slice");
    try {
      Object.defineProperty(String.prototype, "slice", {
        configurable: true,
        writable: true,
        value: () => "/evil.test/",
      });

      assertEquals(
        buildProxyAuthRedirectUrl(new URL("https://evil.test///dashboard")),
        "https://veryfront.com/sign-in?from=%2Fdashboard",
      );
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(String.prototype, "slice", originalDescriptor);
      } else {
        delete (String.prototype as { slice?: unknown }).slice;
      }
    }
  });

  it("keeps origin-form path slash detection stable after String.prototype.charCodeAt is patched", () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(String.prototype, "charCodeAt");
    try {
      Object.defineProperty(String.prototype, "charCodeAt", {
        configurable: true,
        writable: true,
        value: () => 0,
      });

      assertEquals(
        buildProxyAuthRedirectUrl(new URL("https://evil.test///dashboard")),
        "https://veryfront.com/sign-in?from=%2Fdashboard",
      );
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(String.prototype, "charCodeAt", originalDescriptor);
      } else {
        delete (String.prototype as { charCodeAt?: unknown }).charCodeAt;
      }
    }
  });

  it("keeps return paths stable after URL path accessors are patched", () => {
    const descriptors = {
      pathname: Object.getOwnPropertyDescriptor(URL.prototype, "pathname"),
      search: Object.getOwnPropertyDescriptor(URL.prototype, "search"),
    };
    const requestUrl = new URL("https://evil.test/dashboard?ok=1");
    try {
      Object.defineProperty(URL.prototype, "pathname", {
        configurable: true,
        get: () => "/\\outside.example.test",
      });
      Object.defineProperty(URL.prototype, "search", {
        configurable: true,
        get: () => "?next=outside",
      });

      assertEquals(
        buildProxyAuthRedirectUrl(requestUrl),
        "https://veryfront.com/sign-in?from=%2Fdashboard%3Fok%3D1",
      );
    } finally {
      for (const [name, descriptor] of Object.entries(descriptors)) {
        if (descriptor) Object.defineProperty(URL.prototype, name, descriptor);
      }
    }
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

  it("keeps default production host trust stable after String.prototype.endsWith is patched", () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(String.prototype, "endsWith");
    try {
      Object.defineProperty(String.prototype, "endsWith", {
        configurable: true,
        writable: true,
        value: () => true,
      });

      assertEquals(
        buildProxyAuthRedirectUrl(
          new URL("https://app.production.veryfront.com.evil.test/dashboard"),
        ),
        "https://veryfront.com/sign-in?from=%2Fdashboard",
      );
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(String.prototype, "endsWith", originalDescriptor);
      } else {
        delete (String.prototype as { endsWith?: unknown }).endsWith;
      }
    }
  });

  it("normalizes default production hosts after string host helpers are patched", () => {
    const descriptors = {
      trim: Object.getOwnPropertyDescriptor(String.prototype, "trim"),
      includes: Object.getOwnPropertyDescriptor(String.prototype, "includes"),
      toLowerCase: Object.getOwnPropertyDescriptor(String.prototype, "toLowerCase"),
      endsWith: Object.getOwnPropertyDescriptor(String.prototype, "endsWith"),
      slice: Object.getOwnPropertyDescriptor(String.prototype, "slice"),
      startsWith: Object.getOwnPropertyDescriptor(String.prototype, "startsWith"),
      indexOf: Object.getOwnPropertyDescriptor(String.prototype, "indexOf"),
      lastIndexOf: Object.getOwnPropertyDescriptor(String.prototype, "lastIndexOf"),
      charCodeAt: Object.getOwnPropertyDescriptor(String.prototype, "charCodeAt"),
    };
    try {
      Object.defineProperty(String.prototype, "trim", {
        configurable: true,
        writable: true,
        value: () => "",
      });
      Object.defineProperty(String.prototype, "includes", {
        configurable: true,
        writable: true,
        value: () => true,
      });
      Object.defineProperty(String.prototype, "toLowerCase", {
        configurable: true,
        writable: true,
        value: () => "app.production.veryfront.com.evil.test",
      });
      Object.defineProperty(String.prototype, "endsWith", {
        configurable: true,
        writable: true,
        value: () => false,
      });
      Object.defineProperty(String.prototype, "slice", {
        configurable: true,
        writable: true,
        value: () => "evil.test",
      });
      Object.defineProperty(String.prototype, "startsWith", {
        configurable: true,
        writable: true,
        value: () => true,
      });
      Object.defineProperty(String.prototype, "indexOf", {
        configurable: true,
        writable: true,
        value: () => -1,
      });
      Object.defineProperty(String.prototype, "lastIndexOf", {
        configurable: true,
        writable: true,
        value: () => -1,
      });
      Object.defineProperty(String.prototype, "charCodeAt", {
        configurable: true,
        writable: true,
        value: () => 0,
      });

      assertEquals(
        buildProxyAuthRedirectUrl(new URL("https://APP.PRODUCTION.VERYFRONT.COM./dashboard")),
        "https://veryfront.com/sign-in?from=https%3A%2F%2Fapp.production.veryfront.com%2Fdashboard",
      );
    } finally {
      for (const [name, descriptor] of Object.entries(descriptors)) {
        if (descriptor) {
          Object.defineProperty(String.prototype, name, descriptor);
        } else {
          delete (String.prototype as unknown as Record<string, unknown>)[name];
        }
      }
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

import { assertEquals } from "#veryfront/testing/assert";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd";
import type { AuthProvider, TokenPayload } from "#veryfront/extensions/auth/index.ts";
import { register, reset } from "#veryfront/extensions/contracts.ts";
import {
  __resetCachedAuthProviderForTests,
  buildProxyAuthRedirectUrl,
  checkProtectedProxyAccess,
  extractUserIdFromToken,
  isProjectMember,
} from "./proxy-access-control.ts";

describe("proxy/proxy-access-control", () => {
  let previousJwtSecret: string | undefined;

  beforeEach(() => {
    previousJwtSecret = Deno.env.get("JWT_SECRET");
  });

  afterEach(() => {
    reset();
    __resetCachedAuthProviderForTests();
    if (previousJwtSecret === undefined) Deno.env.delete("JWT_SECRET");
    else Deno.env.set("JWT_SECRET", previousJwtSecret);
  });

  it("resolves the current auth provider and contains decoder failures", async () => {
    Deno.env.set("JWT_SECRET", "test-secret");
    const provider = (userId: string, decodeThrows = false) =>
      ({
        decode() {
          if (decodeThrows) throw new Error("malformed token");
          return { alg: "HS256" };
        },
        verify: () => Promise.resolve({ sub: userId, userId } as TokenPayload),
      }) as unknown as AuthProvider;

    register("AuthProvider", provider("first-user"));
    assertEquals(
      await extractUserIdFromToken("first", "https://api.example.test"),
      "first-user",
    );

    reset();
    register("AuthProvider", provider("second-user"));
    assertEquals(
      await extractUserIdFromToken("second", "https://api.example.test"),
      "second-user",
    );

    reset();
    register("AuthProvider", provider("unused", true));
    assertEquals(
      await extractUserIdFromToken("malformed", "https://api.example.test"),
      undefined,
    );
  });

  it("does not invoke accessors on a verified token payload", async () => {
    Deno.env.set("JWT_SECRET", "test-secret");
    let accessorInvoked = false;
    const payload = Object.defineProperty({}, "userId", {
      enumerable: true,
      get() {
        accessorInvoked = true;
        return "accessor-user";
      },
    });
    register("AuthProvider", {
      decode: () => ({ alg: "HS256" }),
      verify: () => Promise.resolve(payload as unknown as TokenPayload),
    } as unknown as AuthProvider);

    assertEquals(
      await extractUserIdFromToken("accessor-payload", "https://api.example.test"),
      undefined,
    );
    assertEquals(accessorInvoked, false);

    reset();
    let headerAccessorInvoked = false;
    const header = Object.defineProperty({}, "alg", {
      enumerable: true,
      get() {
        headerAccessorInvoked = true;
        return "HS256";
      },
    });
    register("AuthProvider", {
      decode: () => header,
      verify: () => Promise.resolve({ sub: "unused", userId: "unused" } as TokenPayload),
    } as unknown as AuthProvider);

    assertEquals(
      await extractUserIdFromToken("accessor-header", "https://api.example.test"),
      undefined,
    );
    assertEquals(headerAccessorInvoked, false);
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

import "#veryfront/schemas/_test-setup.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { expect } from "#std/expect.ts";
import type { HandlerContext, SecurityConfig } from "#veryfront/types";
import { AuthHandler } from "./auth.ts";

/**
 * Tests that the AuthHandler sanitizes the Basic auth realm value
 * to prevent CRLF/header injection via user-configured realm strings.
 */
describe("AuthHandler realm sanitization", () => {
  function createHandler(): AuthHandler {
    return new AuthHandler();
  }

  function createCtx(realm?: unknown): HandlerContext {
    const basic: Record<string, unknown> = { username: "admin", password: "secret" };
    if (realm !== undefined) basic.realm = realm;
    return {
      projectDir: "/tmp/auth-test",
      securityConfig: { auth: { basic } } as unknown as SecurityConfig,
      cspUserHeader: null,
      adapter: {
        env: { get: () => "" },
      } as unknown as HandlerContext["adapter"],
      isLocalProject: false,
    };
  }

  async function getWwwAuthenticate(handler: AuthHandler, realm?: unknown): Promise<string> {
    const ctx = createCtx(realm);
    const req = new Request("http://localhost/test");
    const result = await handler.handle(req, ctx);
    const response = result.response as Response;
    return response.headers.get("WWW-Authenticate") ?? "";
  }

  it("passes clean realm values through", async () => {
    const handler = createHandler();
    const header = await getWwwAuthenticate(handler, "My App");
    expect(header).toBe('Basic realm="My App"');
  });

  it("strips double quotes from realm", async () => {
    const handler = createHandler();
    const header = await getWwwAuthenticate(handler, 'break"out');
    expect(header).toBe('Basic realm="breakout"');
    expect(header).not.toContain('""');
  });

  it("strips backslashes from realm", async () => {
    const handler = createHandler();
    const header = await getWwwAuthenticate(handler, "back\\slash");
    expect(header).toBe('Basic realm="backslash"');
  });

  it("strips CRLF characters from realm", async () => {
    const handler = createHandler();
    const header = await getWwwAuthenticate(handler, "line\r\nX-Injected: true");
    expect(header).toBe('Basic realm="lineX-Injected: true"');
    expect(header).not.toContain("\r");
    expect(header).not.toContain("\n");
  });

  it("strips null bytes and other control characters from realm", async () => {
    const handler = createHandler();
    const header = await getWwwAuthenticate(handler, "null\x00byte\x01ctrl");
    expect(header).toBe('Basic realm="nullbytectrl"');
  });

  it("uses default realm when none is configured", async () => {
    const handler = createHandler();
    const header = await getWwwAuthenticate(handler);
    expect(header).toBe('Basic realm="Secure Area"');
  });

  it("coerces non-string realm values to string", async () => {
    const handler = createHandler();
    const header = await getWwwAuthenticate(handler, 12345);
    expect(header).toBe('Basic realm="12345"');
  });

  it("does not invoke conversion hooks on an invalid realm value", async () => {
    const handler = createHandler();
    let conversions = 0;
    const hostileRealm = {
      [Symbol.toPrimitive]() {
        conversions++;
        throw new Error("realm conversion must not run");
      },
    };

    const header = await getWwwAuthenticate(handler, hostileRealm);

    expect(header).toBe('Basic realm="Secure Area"');
    expect(conversions).toBe(0);
  });

  it("keeps the outer Basic challenge request-local during CORS re-entry", async () => {
    const handler = createHandler();
    const outerCtx = createCtx("Outer Realm");
    if (!outerCtx.securityConfig) throw new Error("test security config is required");

    outerCtx.securityConfig.cors = {
      origin: () => {
        void handler.handle(
          new Request("http://localhost/inner"),
          createCtx("Inner Realm"),
        );
        return true;
      },
    };

    const result = await handler.handle(
      new Request("http://localhost/outer", {
        headers: { origin: "https://client.example" },
      }),
      outerCtx,
    );

    expect(result.response?.headers.get("WWW-Authenticate")).toBe(
      'Basic realm="Outer Realm"',
    );
  });

  it("applies the resolved CORS and security policy to unauthorized responses", async () => {
    const handler = createHandler();
    const ctx = createCtx();
    if (!ctx.securityConfig) throw new Error("test security config is required");
    ctx.securityConfig.cors = {
      origin: "https://client.example",
      credentials: true,
    };
    const req = new Request("http://localhost/test", {
      headers: { origin: "https://client.example" },
    });

    const result = await handler.handle(req, ctx);
    const response = result.response as Response;

    expect(response.status).toBe(401);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://client.example",
    );
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBe("true");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns a Bearer challenge with the same hardened unauthorized response", async () => {
    const handler = createHandler();
    const ctx: HandlerContext = {
      projectDir: "/tmp/auth-test",
      securityConfig: {
        auth: { bearer: { token: "expected-token" } },
        cors: { origin: "https://client.example" },
      } as SecurityConfig,
      cspUserHeader: null,
      adapter: {
        env: { get: () => "" },
      } as unknown as HandlerContext["adapter"],
      isLocalProject: false,
    };
    const req = new Request("http://localhost/test", {
      headers: {
        authorization: "Bearer wrong-token",
        origin: "https://client.example",
      },
    });

    const result = await handler.handle(req, ctx);
    const response = result.response as Response;

    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toBe("Bearer");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://client.example",
    );
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("fails closed when environment variables configure both auth modes", async () => {
    const handler = createHandler();
    const testGlobals = globalThis as Record<string, unknown>;
    const previousTestFlag = testGlobals.__vfTestEnv;
    const credentials: Record<string, string> = {
      VERYFRONT_BASIC_USER: "admin",
      VERYFRONT_BASIC_PASS: "secret",
      VERYFRONT_BEARER_TOKEN: "expected-token",
    };
    const ctx: HandlerContext = {
      projectDir: "/tmp/auth-test",
      securityConfig: null,
      cspUserHeader: null,
      adapter: {
        env: { get: (name: string) => credentials[name] },
      } as unknown as HandlerContext["adapter"],
      isLocalProject: false,
    };

    testGlobals.__vfTestEnv = false;
    try {
      for (
        const authorization of [
          `Basic ${btoa("admin:secret")}`,
          "Bearer expected-token",
        ]
      ) {
        const result = await handler.handle(
          new Request("http://localhost/test", {
            headers: { authorization },
          }),
          ctx,
        );

        expect(result.continue).not.toBe(true);
        expect(result.response?.status).toBe(401);
        expect(result.response?.headers.get("WWW-Authenticate")).toBe(
          'Basic realm="Secure Area", Bearer',
        );
      }
    } finally {
      testGlobals.__vfTestEnv = previousTestFlag;
    }
  });
});

import { describe, it } from "#veryfront/testing/bdd.ts";
import { expect } from "#std/expect.ts";
import { AuthHandler } from "./auth.ts";

/**
 * Tests that the AuthHandler sanitizes the Basic auth realm value
 * to prevent CRLF/header injection via user-configured realm strings.
 */
describe("AuthHandler realm sanitization", () => {
  function createHandler(): AuthHandler {
    return new AuthHandler();
  }

  function createCtx(realm: string) {
    return {
      securityConfig: {
        auth: {
          basic: {
            username: "admin",
            password: "secret",
            realm,
          },
        },
      },
      adapter: { env: { get: () => "" } },
      isLocalProject: false,
    };
  }

  async function getWwwAuthenticate(handler: AuthHandler, realm: string): Promise<string> {
    const ctx = createCtx(realm);
    // Send request with no auth header to trigger 401 with WWW-Authenticate
    const req = new Request("http://localhost/test");
    const result = await handler.handle(req, ctx as any);
    const response = (result as any).response as Response;
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
    const ctx = {
      securityConfig: {
        auth: {
          basic: { username: "admin", password: "secret" },
        },
      },
      adapter: { env: { get: () => "" } },
      isLocalProject: false,
    };
    const req = new Request("http://localhost/test");
    const result = await handler.handle(req, ctx as any);
    const response = (result as any).response as Response;
    const header = response.headers.get("WWW-Authenticate") ?? "";
    expect(header).toBe('Basic realm="Secure Area"');
  });
});

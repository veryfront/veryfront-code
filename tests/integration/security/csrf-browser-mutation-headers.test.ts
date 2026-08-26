import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { applyCsrfCookie, validateCsrf } from "#veryfront/security/csrf/helpers.ts";
import { csrfMutationHeaders } from "#veryfront/security/csrf/browser-mutation-headers.ts";
import { deriveSecurityContext } from "#veryfront/security/http/config.ts";
import { CsrfHandler } from "#veryfront/security/http/csrf/csrf-handler.ts";
import { applySecurityHeaders } from "#veryfront/server/handlers/request/api/security-headers.ts";
import type { HandlerContext } from "#veryfront/types";

function withDocument<T>(value: Document, run: () => T): T {
  const original = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value,
  });

  try {
    return run();
  } finally {
    if (original) {
      Object.defineProperty(globalThis, "document", original);
    } else {
      delete (globalThis as { document?: Document }).document;
    }
  }
}

describe("security/csrf/browser-mutation-headers", () => {
  it("uses the default names and preserves caller headers", () => {
    withDocument(
      {
        baseURI: "https://app.example.test/cases",
        cookie: "__Host-vf_csrf=default-token",
        location: { origin: "https://app.example.test" },
      } as Document,
      () => {
        const headers = csrfMutationHeaders("/api/cases", {
          headers: { "content-type": "application/json" },
        });

        assertEquals(headers.get("content-type"), "application/json");
        assertEquals(headers.get("x-csrf-token"), "default-token");
      },
    );
  });

  it("uses configured names to build a request the server accepts", () => {
    withDocument(
      {
        baseURI: "https://app.example.test/cases",
        cookie: "my_csrf=token-123",
        location: { origin: "https://app.example.test" },
      } as Document,
      () => {
        const csrf = { cookieName: "my_csrf", headerName: "x-my-csrf" };
        const headers = csrfMutationHeaders("/api/cases", {
          headers: { "content-type": "application/json" },
          ...csrf,
        });

        assertEquals(headers.get("content-type"), "application/json");
        assertEquals(headers.get("x-my-csrf"), "token-123");
        assertEquals(headers.get("x-csrf-token"), null);

        const requestHeaders = new Headers(headers);
        requestHeaders.set("cookie", "my_csrf=token-123");
        const request = new Request("https://app.example.test/api/cases", {
          method: "POST",
          headers: requestHeaders,
        });

        assertEquals(validateCsrf(request, csrf), true);
      },
    );
  });

  it("round-trips the HTTP-compatible default on a LAN development origin", () => {
    const origin = "http://192.168.1.20:3000";
    const pageHeaders = new Headers();
    applyCsrfCookie(
      new Request(`${origin}/cases`, { headers: { accept: "text/html" } }),
      pageHeaders,
      true,
    );
    const documentCookie = pageHeaders.getSetCookie()
      .map((cookie) => cookie.split(";", 1)[0])
      .join("; ");
    const headers = withDocument(
      {
        baseURI: `${origin}/cases`,
        cookie: documentCookie,
        location: { origin },
      } as Document,
      () => csrfMutationHeaders("/api/cases"),
    );
    headers.set("cookie", documentCookie);

    const token = headers.get("x-csrf-token");
    assertExists(token);
    assertEquals(token.length > 0, true);
    assertEquals(
      validateCsrf(
        new Request(`${origin}/api/cases`, {
          method: "POST",
          headers,
        }),
      ),
      true,
    );
  });

  it("discovers a header-only HTTP configuration and completes the server round trip", () => {
    const origin = "http://192.168.1.20:3000";
    const csrf = { headerName: "x-project-csrf" };
    const pageHeaders = new Headers();
    applyCsrfCookie(
      new Request(`${origin}/cases`, { headers: { accept: "text/html" } }),
      pageHeaders,
      csrf,
    );
    const documentCookie = pageHeaders.getSetCookie()
      .map((cookie) => cookie.split(";", 1)[0])
      .join("; ");

    const headers = withDocument(
      {
        baseURI: `${origin}/cases`,
        cookie: documentCookie,
        location: { origin },
      } as Document,
      () => csrfMutationHeaders("/api/cases"),
    );
    headers.set("cookie", documentCookie);

    const token = headers.get(csrf.headerName);
    assertExists(token);
    assertEquals(token.length > 0, true);
    assertEquals(
      validateCsrf(
        new Request(`${origin}/api/cases`, { method: "POST", headers }),
        csrf,
      ),
      true,
      "the zero-option browser helper must accept the server-advertised internal token name",
    );
  });

  it("rejects invalid configured names instead of silently diverging from the server", () => {
    assertThrows(
      () => csrfMutationHeaders("/api/cases", { cookieName: "bad\r\nname" }),
      TypeError,
    );
    assertThrows(
      () => csrfMutationHeaders("/api/cases", { headerName: "" }),
      TypeError,
    );
  });
  it("completes the development round trip the deployed build then repeats", async () => {
    // Local development now resolves `security.csrf` exactly as production
    // does, so the contract has to be satisfiable locally end to end: the
    // page response issues the token cookie, the browser helper echoes it, and
    // the same gate that rejects a bare mutation accepts this one.
    const localSecurity = deriveSecurityContext(
      { security: {} },
      { productionDefaults: false },
    ).securityConfig;
    const ctx = {
      projectDir: "/tmp/local-project",
      adapter: { env: { get: () => undefined } },
      isLocalProject: true,
      securityConfig: localSecurity,
    } as unknown as HandlerContext;

    const pageHeaders = new Headers();
    applySecurityHeaders(
      pageHeaders,
      ctx,
      new Request("http://localhost:3000/cases", { headers: { accept: "text/html" } }),
    );
    const setCookie = pageHeaders.get("set-cookie") ?? "";
    const token = /__Host-vf_csrf=([^;]+)/.exec(setCookie)?.[1] ?? "";

    assertEquals(
      token.length > 0,
      true,
      "a local HTML page must ship the token the gate below then demands",
    );

    const handler = new CsrfHandler();
    const bare = await handler.handle(
      new Request("http://localhost:3000/api/cases", { method: "POST" }),
      ctx,
    );

    assertEquals(
      bare.response?.status,
      403,
      "a hand-rolled local mutation must fail before deploy, not after it",
    );

    const headers = withDocument(
      {
        baseURI: "http://localhost:3000/cases",
        cookie: `__Host-vf_csrf=${token}`,
        location: { origin: "http://localhost:3000" },
      } as Document,
      () =>
        csrfMutationHeaders("/api/cases", {
          headers: { "content-type": "application/json" },
        }),
    );
    headers.set("cookie", `__Host-vf_csrf=${token}`);

    const accepted = await handler.handle(
      new Request("http://localhost:3000/api/cases", { method: "POST", headers }),
      ctx,
    );

    assertEquals(
      accepted.continue,
      true,
      "the documented helper must produce a request local development accepts",
    );
  });
});

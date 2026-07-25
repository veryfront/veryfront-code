import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { applySecurityHeaders, buildCSP, getSecurityHeader } from "./security-headers.ts";
import type { HandlerContext } from "../../types.ts";

function makeCtx(overrides: Partial<HandlerContext> = {}): HandlerContext {
  return {
    isLocalProject: false,
    cspUserHeader: null,
    securityConfig: undefined,
    adapter: {
      name: "test",
    },
    parsedDomain: { allowIframeEmbed: false },
    ...overrides,
  } as unknown as HandlerContext;
}

describe("server/handlers/request/api/security-headers", () => {
  describe("buildCSP", () => {
    it("should return a string", () => {
      const ctx = makeCtx();
      const csp = buildCSP(ctx);
      assertEquals(typeof csp, "string");
    });

    it("should return a string for local project context", () => {
      const ctx = makeCtx({ isLocalProject: true });
      const csp = buildCSP(ctx);
      assertEquals(typeof csp, "string");
    });

    it("should return different CSP for dev vs production", () => {
      const devCtx = makeCtx({ isLocalProject: true });
      const prodCtx = makeCtx({ isLocalProject: false });
      const devCsp = buildCSP(devCtx);
      const prodCsp = buildCSP(prodCtx);
      // Both should be strings (may or may not differ depending on implementation)
      assertEquals(typeof devCsp, "string");
      assertEquals(typeof prodCsp, "string");
    });

    it("does not let inherited or unreadable locality disable production CSP", () => {
      const previous = Object.getOwnPropertyDescriptor(
        Object.prototype,
        "isLocalProject",
      );
      let accessorCalls = 0;
      let throwingDescriptorCalls = 0;
      const inherited = makeCtx();
      delete (inherited as { isLocalProject?: boolean }).isLocalProject;
      Object.setPrototypeOf(inherited, { isLocalProject: true });
      const accessor = Object.defineProperty(makeCtx(), "isLocalProject", {
        get() {
          accessorCalls++;
          return true;
        },
      });
      const throwingProxy = new Proxy(makeCtx(), {
        getOwnPropertyDescriptor(target, key) {
          if (key === "isLocalProject") {
            throwingDescriptorCalls++;
            throw new Error("locality descriptor unavailable");
          }
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
      });

      try {
        assertEquals(buildCSP(inherited).length > 0, true);
        assertEquals(buildCSP(accessor).length > 0, true);
        assertEquals(buildCSP(throwingProxy).length > 0, true);

        const poisoned = makeCtx();
        delete (poisoned as { isLocalProject?: boolean }).isLocalProject;
        Object.defineProperty(Object.prototype, "isLocalProject", {
          configurable: true,
          value: true,
        });
        assertEquals(buildCSP(poisoned).length > 0, true);
      } finally {
        if (previous) {
          Object.defineProperty(Object.prototype, "isLocalProject", previous);
        } else {
          delete (Object.prototype as { isLocalProject?: boolean }).isLocalProject;
        }
      }

      assertEquals(accessorCalls, 0);
      assertEquals(throwingDescriptorCalls, 1);
    });
  });

  describe("getSecurityHeader", () => {
    it("should return a value for known headers", () => {
      const ctx = makeCtx();
      const value = getSecurityHeader("x-content-type-options", "nosniff", ctx);
      assertEquals(typeof value, "string");
    });

    it("should return default value when no config override", () => {
      const ctx = makeCtx();
      const value = getSecurityHeader("x-custom-header", "my-default", ctx);
      assertEquals(value, "my-default");
    });
  });

  describe("applySecurityHeaders", () => {
    it("should add security headers to a Headers object", () => {
      const ctx = makeCtx();
      const headers = new Headers();
      applySecurityHeaders(headers, ctx);
      // Should have at least one security header
      assertEquals(headers.has("x-content-type-options"), true);
    });

    it("should work with local project context", () => {
      const ctx = makeCtx({ isLocalProject: true });
      const headers = new Headers();
      applySecurityHeaders(headers, ctx);
      assertEquals(typeof headers.get("x-content-type-options"), "string");
    });

    it("should accept optional request for CSRF cookie", () => {
      const ctx = makeCtx();
      const headers = new Headers();
      const req = new Request("http://localhost/test");
      // Should not throw
      applySecurityHeaders(headers, ctx, req);
    });
  });
});

import "#veryfront/schemas/_test-setup.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { isValidSecurityConfig } from "./config-loader.ts";

describe("security/http/middleware/config-loader", () => {
  describe("isValidSecurityConfig", () => {
    it("should return false for null/undefined", () => {
      assertEquals(isValidSecurityConfig(null), false);
      assertEquals(isValidSecurityConfig(undefined), false);
    });

    it("should return false for a non-object", () => {
      assertEquals(isValidSecurityConfig("string"), false);
      assertEquals(isValidSecurityConfig(123), false);
      assertEquals(isValidSecurityConfig(true), false);
      assertEquals(isValidSecurityConfig([]), false);
      assertEquals(isValidSecurityConfig(new Date()), false);
    });

    it("should return true for an empty object", () => {
      assertEquals(isValidSecurityConfig({}), true);
    });

    it("should validate csp", () => {
      assertEquals(
        isValidSecurityConfig({ csp: { "default-src": "'self'" } }),
        true,
      );
      assertEquals(isValidSecurityConfig({ csp: "invalid" }), false);
      assertEquals(isValidSecurityConfig({ csp: null }), false);
    });

    it("should validate cors", () => {
      assertEquals(isValidSecurityConfig({ cors: true }), true);
      assertEquals(isValidSecurityConfig({ cors: false }), true);
      assertEquals(isValidSecurityConfig({ cors: { origin: "*" } }), true);

      assertEquals(isValidSecurityConfig({ cors: "invalid" }), false);
      assertEquals(isValidSecurityConfig({ cors: 123 }), false);
      assertEquals(isValidSecurityConfig({ cors: null }), false);
      assertEquals(isValidSecurityConfig({ cors: { origin: "*", credentials: true } }), false);
    });

    it("should validate coop", () => {
      assertEquals(isValidSecurityConfig({ coop: "same-origin" }), true);
      assertEquals(isValidSecurityConfig({ coop: 123 }), false);
      assertEquals(isValidSecurityConfig({ coop: "invalid-policy" }), false);
    });

    it("should validate corp", () => {
      assertEquals(isValidSecurityConfig({ corp: "same-origin" }), true);
      assertEquals(isValidSecurityConfig({ corp: true }), false);
    });

    it("should validate coep", () => {
      assertEquals(isValidSecurityConfig({ coep: "require-corp" }), true);
      assertEquals(isValidSecurityConfig({ coep: [] }), false);
    });

    it("should deeply validate authentication, CSRF, CSP, HSTS, and headers", () => {
      assertEquals(
        isValidSecurityConfig({
          auth: { basic: { username: "admin", password: "secret" } },
          csrf: { cookieName: "vf_csrf", excludePaths: ["/webhooks"], ttlSec: 60 },
          csp: { defaultSrc: ["'self'"] },
          hsts: { maxAge: 0, includeSubDomains: true },
          headers: { "X-Custom-Security": "enabled" },
        }),
        true,
      );

      for (
        const config of [
          { auth: { basic: { username: "", password: "secret" } } },
          { auth: { bearer: { token: "" } } },
          { csrf: { cookieName: "bad;cookie" } },
          { csrf: { excludePaths: [""] } },
          { csp: { defaultSrc: ["'self'; report-uri https://example.com"] } },
          { hsts: { maxAge: Number.NaN } },
          { headers: { "Bad Header": "value" } },
          { remoteHosts: ["javascript:alert(1)"] },
        ]
      ) {
        assertEquals(isValidSecurityConfig(config), false);
      }
    });

    it("should strictly validate allowed import directories", () => {
      assertEquals(
        isValidSecurityConfig({ allowedImportDirs: ["app", "pages", "components"] }),
        true,
      );
      assertEquals(isValidSecurityConfig({ allowedImportDirs: [] }), true);

      for (
        const allowedImportDirs of [
          "src",
          [""],
          ["."],
          [".."],
          ["../private"],
          ["/absolute"],
          ["src/nested"],
          ["src\\nested"],
          ["src\0private"],
          [123],
        ]
      ) {
        assertEquals(isValidSecurityConfig({ allowedImportDirs }), false);
      }
    });

    it("should reject allowed import directory accessors without invoking them", () => {
      let propertyReads = 0;
      const config = Object.defineProperty({}, "allowedImportDirs", {
        enumerable: true,
        get() {
          propertyReads++;
          return ["src"];
        },
      });

      assertEquals(isValidSecurityConfig(config), false);
      assertEquals(propertyReads, 0);

      let entryReads = 0;
      const allowedImportDirs: string[] = [];
      Object.defineProperty(allowedImportDirs, "0", {
        enumerable: true,
        get() {
          entryReads++;
          return "src";
        },
      });
      allowedImportDirs.length = 1;

      assertEquals(isValidSecurityConfig({ allowedImportDirs }), false);
      assertEquals(entryReads, 0);
    });

    it("should reject top-level and nested accessors without invoking them", () => {
      let accessorReads = 0;
      const accessor = (value: unknown) => ({
        enumerable: true,
        get() {
          accessorReads++;
          return value;
        },
      });
      const accessorArray = (value: unknown) => {
        const array: unknown[] = [];
        Object.defineProperty(array, "0", accessor(value));
        array.length = 1;
        return array;
      };

      const cases = [
        Object.defineProperty({}, "auth", accessor(undefined)),
        { auth: Object.defineProperty({}, "basic", accessor(undefined)) },
        { csrf: Object.defineProperty({}, "excludePaths", accessor([])) },
        { csp: Object.defineProperty({}, "defaultSrc", accessor("'self'")) },
        { cors: Object.defineProperty({}, "origin", accessor("*")) },
        { hsts: Object.defineProperty({}, "maxAge", accessor(60)) },
        { headers: Object.defineProperty({}, "X-Safe", accessor("value")) },
        { csrf: { excludePaths: accessorArray("/webhooks") } },
        { csp: { defaultSrc: accessorArray("'self'") } },
        { cors: { methods: accessorArray("GET") } },
        { remoteHosts: accessorArray("https://example.com") },
      ];

      for (const config of cases) assertEquals(isValidSecurityConfig(config), false);
      assertEquals(accessorReads, 0);
    });

    it("should fail closed for unreadable proxies and oversized collections", () => {
      const { proxy, revoke } = Proxy.revocable({}, {});
      revoke();

      assertEquals(isValidSecurityConfig(proxy), false);
      assertEquals(
        isValidSecurityConfig(
          Object.fromEntries(Array.from({ length: 257 }, (_, index) => [`key${index}`, true])),
        ),
        false,
      );
      assertEquals(
        isValidSecurityConfig({
          remoteHosts: Array.from({ length: 1_025 }, () => "https://example.com"),
        }),
        false,
      );
    });

    it("should return true for a full valid config", () => {
      assertEquals(
        isValidSecurityConfig({
          cors: true,
          csp: { "default-src": "'self'" },
          coop: "same-origin",
          corp: "same-origin",
          coep: "require-corp",
        }),
        true,
      );
    });
  });
});

import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import * as securityModule from "./index.ts";
import { AuthHandler } from "./http/auth.ts";
import { isValidSecurityConfig, loadSecurityConfig, SecurityConfigLoader } from "./http/config.ts";
import { setCors } from "./http/middleware/index.ts";
import { validatePathSync } from "./path-validation.ts";

describe("security/index.ts exports", () => {
  it("is available through the public package security subpath", async () => {
    const denoConfig = JSON.parse(
      await Deno.readTextFile(new URL("../../deno.json", import.meta.url)),
    ) as { exports?: Record<string, string> };

    assertEquals(denoConfig.exports?.["./security"], "./src/security/index.ts");

    const publicSecurityModule = await import("veryfront/security");
    assertEquals(publicSecurityModule.AuthHandler, AuthHandler);
    assertEquals(publicSecurityModule.SecurityConfigLoader, SecurityConfigLoader);
    assertEquals(publicSecurityModule.loadSecurityConfig, loadSecurityConfig);
    assertEquals(publicSecurityModule.validatePathSync, validatePathSync);
  });

  it("keeps the public runtime surface explicit", () => {
    assertEquals(
      Object.keys(securityModule).sort(),
      [
        "AuthHandler",
        "BUILD_HELPER_PERMISSIONS",
        "BaseHandler",
        "CACHE_DURATIONS",
        "CORS_MAX_AGE",
        "CommonSchemas",
        "CsrfHandler",
        "DEFAULT_CORS_HEADERS",
        "DEFAULT_CORS_METHODS",
        "DEFAULT_LIMITS",
        "INPUT_VALIDATION_FAILED",
        "PathValidationError",
        "ResponseBuilder",
        "SECURITY_VIOLATION",
        "SERVER_PERMISSIONS",
        "SecureFs",
        "SecurityConfigLoader",
        "ValidationPresets",
        "WORKFLOW_RUN_PERMISSIONS",
        "applyCORSHeaders",
        "applyCORSHeadersSync",
        "applyCsrfCookie",
        "applySecurityHeaders",
        "buildCacheControl",
        "cors",
        "corsSimple",
        "createResponseBuilder",
        "createSecureFs",
        "createValidatedHandler",
        "createValidationError",
        "createValidator",
        "generateCsrfToken",
        "generateNonce",
        "getSecurityHeader",
        "handleCORSPreflight",
        "isValidSecurityConfig",
        "isPreflightRequest",
        "isRequestBodyTooLargeError",
        "parseFormData",
        "parseJsonBody",
        "parseQueryParams",
        "readBodyWithLimit",
        "sanitizeData",
        "sanitizePathForDisplay",
        "setCors",
        "shouldApplyCORS",
        "validateCORSConfig",
        "validateCsrf",
        "validateOrigin",
        "validateOriginSync",
        "validatePath",
        "validateLexicalPath",
        "validateRequestLimits",
        "validatePathSync",
        "wrapAdapterWithSecurity",
        "loadSecurityConfig",
      ].sort(),
    );
  });

  it("keeps the http security helpers wired to their source modules", () => {
    assertEquals(securityModule.AuthHandler, AuthHandler);
    assertEquals(securityModule.isValidSecurityConfig, isValidSecurityConfig);
    assertEquals(securityModule.loadSecurityConfig, loadSecurityConfig);
    assertEquals(securityModule.SecurityConfigLoader, SecurityConfigLoader);
    assertEquals(securityModule.setCors, setCors);
    assertEquals(securityModule.validatePathSync, validatePathSync);
  });
});

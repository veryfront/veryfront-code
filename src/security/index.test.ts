import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import * as securityModule from "./index.ts";
import { AuthHandler } from "./http/auth.ts";
import { SecurityConfigLoader } from "./http/config.ts";
import { loadSecurityConfig, setCors } from "./http/middleware/index.ts";

describe("security/index.ts exports", () => {
  it("keeps the http security helpers wired to their source modules", () => {
    assertEquals(securityModule.AuthHandler, AuthHandler);
    assertEquals(securityModule.SecurityConfigLoader, SecurityConfigLoader);
    assertEquals(securityModule.loadSecurityConfig, loadSecurityConfig);
    assertEquals(securityModule.setCors, setCors);
  });
});

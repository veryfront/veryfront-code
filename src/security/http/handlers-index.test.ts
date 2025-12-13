import { describe, it } from "std/testing/bdd.ts";
import { assertExists, assertEquals } from "std/assert/mod.ts";
import {
  AuthHandler,
  loadSecurityConfig,
  SecurityConfigLoader,
  setCors,
} from "./handlers-index.ts";

describe("Security HTTP Handlers Index", () => {
  it("should export AuthHandler", () => {
    assertExists(AuthHandler);
    const handler = new AuthHandler();
    assertExists(handler);
  });

  it("should export SecurityConfigLoader", () => {
    assertExists(SecurityConfigLoader);
  });

  it("should export loadSecurityConfig function", () => {
    assertExists(loadSecurityConfig);
    assertEquals(typeof loadSecurityConfig, "function");
  });

  it("should export setCors function", () => {
    assertExists(setCors);
    assertEquals(typeof setCors, "function");
  });
});

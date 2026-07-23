import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  isLibModuleName,
  LIB_MODULE_PATHS,
  resolveLibModulePath,
} from "./lib-module-catalog.ts";

describe("self-hosted library module catalog", () => {
  it("accepts only exact public module names", () => {
    for (const name of Object.keys(LIB_MODULE_PATHS)) {
      assertEquals(isLibModuleName(name), true, name);
    }
    for (const name of ["../chat.js", "chat.js/private", "CHAT.js", "constructor"]) {
      assertEquals(isLibModuleName(name), false, name);
    }
  });

  it("resolves catalog entries beneath the package directory", () => {
    assertEquals(
      resolveLibModulePath("chat.js", "/project"),
      "/project/node_modules/veryfront/esm/src/chat/index.js",
    );
  });
});

import "#veryfront/schemas/_test-setup.ts";
/**
 * LibModulesHandler Tests
 *
 * Tests the allowed modules whitelist and module path resolution logic.
 */

import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { LIB_MODULE_PATHS, LibModulesHandler } from "./lib-modules.handler.ts";

function createHandler(): LibModulesHandler {
  return new LibModulesHandler();
}

function getPattern(handler: LibModulesHandler, method: string): RegExp {
  const patterns = handler.metadata.patterns;
  if (!patterns?.length) throw new Error("No patterns defined");

  const pattern = patterns.find((p) => p.method === method)?.pattern;
  if (!(pattern instanceof RegExp)) {
    throw new Error(`Pattern for method ${method} not found or not a RegExp`);
  }

  return pattern;
}

describe("LibModulesHandler", () => {
  describe("metadata", () => {
    it("should have correct handler name", () => {
      const handler = createHandler();
      assertEquals(handler.metadata.name, "LibModulesHandler");
    });

    it("should have priority defined", () => {
      const handler = createHandler();
      assertExists(handler.metadata.priority);
      assertEquals(typeof handler.metadata.priority, "number");
    });

    it("should have two patterns (GET and HEAD)", () => {
      const handler = createHandler();
      assertExists(handler.metadata.patterns);
      assertEquals(handler.metadata.patterns?.length, 2);
    });

    it("should match GET requests to /_veryfront/lib/", () => {
      const pattern = getPattern(createHandler(), "GET");

      assertEquals(pattern.test("/_veryfront/lib/agent/react.js"), true);
      assertEquals(pattern.test("/_veryfront/lib/components/chat.js"), true);
      assertEquals(pattern.test("/_veryfront/lib/primitives.js"), true);
    });

    it("should match HEAD requests to /_veryfront/lib/", () => {
      const pattern = getPattern(createHandler(), "HEAD");
      assertEquals(pattern.test("/_veryfront/lib/agent/react.js"), true);
    });

    it("should not match other paths", () => {
      const pattern = getPattern(createHandler(), "GET");

      assertEquals(pattern.test("/api/users"), false);
      assertEquals(pattern.test("/veryfront/lib/chat/react.js"), false);
      assertEquals(pattern.test("/"), false);
    });
  });

  describe("ALLOWED_MODULES whitelist", () => {
    it("should resolve allowed self-hosted module paths", () => {
      assertEquals(LIB_MODULE_PATHS["chat.js"], "esm/src/chat/index.js");
      assertEquals(LIB_MODULE_PATHS["markdown.js"], "esm/src/markdown/index.js");
      assertEquals(LIB_MODULE_PATHS["mdx.js"], "esm/src/mdx/index.js");
      assertEquals(LIB_MODULE_PATHS["workflow.js"], "esm/src/workflow/react/index.js");
    });
  });

  describe("URL pattern matching", () => {
    it("should match lib module path prefix", () => {
      const pattern = getPattern(createHandler(), "GET");

      assertEquals(pattern.test("/_veryfront/lib/"), true);
      assertEquals(pattern.test("/_veryfront/lib/anything"), true);
    });

    it("should not match paths without /_veryfront/lib/ prefix", () => {
      const pattern = getPattern(createHandler(), "GET");

      assertEquals(pattern.test("/veryfront/lib/agent/react.js"), false);
      assertEquals(pattern.test("/_veryfront/agent/react.js"), false);
      assertEquals(pattern.test("/lib/agent/react.js"), false);
    });

    it("should be case sensitive", () => {
      const pattern = getPattern(createHandler(), "GET");

      assertEquals(pattern.test("/_veryfront/lib/agent/react.js"), true);
      assertEquals(pattern.test("/_VERYFRONT/lib/agent/react.js"), false);
      assertEquals(pattern.test("/_Veryfront/lib/agent/react.js"), false);
    });
  });

  describe("handler instance", () => {
    it("should be instantiable", () => {
      const handler = createHandler();
      assertExists(handler);
    });

    it("should have handle method", () => {
      const handler = createHandler();
      assertEquals(typeof handler.handle, "function");
    });

    it("should extend BaseHandler", () => {
      const handler = createHandler();
      assertExists(handler.metadata);
      assertExists(handler.handle);
    });
  });
});

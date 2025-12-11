
import { assertEquals, assertExists } from "std/assert/mod.ts";
import { describe, it } from "std/testing/bdd.ts";
import { LibModulesHandler } from "./lib-modules-handler.ts";

function getRegExpPattern(handler: LibModulesHandler, index: number): RegExp {
  const patterns = handler.metadata.patterns;
  if (!patterns || patterns.length === 0) {
    throw new Error("No patterns defined");
  }
  const pattern = patterns[index]?.pattern;
  if (!(pattern instanceof RegExp)) {
    throw new Error(`Pattern at index ${index} is not a RegExp`);
  }
  return pattern;
}

function findPatternByMethod(handler: LibModulesHandler, method: string): RegExp {
  const patterns = handler.metadata.patterns;
  if (!patterns) {
    throw new Error("No patterns defined");
  }
  const found = patterns.find((p) => p.method === method);
  if (!found || !(found.pattern instanceof RegExp)) {
    throw new Error(`Pattern for method ${method} not found or not a RegExp`);
  }
  return found.pattern;
}

describe("LibModulesHandler", () => {
  describe("metadata", () => {
    it("should have correct handler name", () => {
      const handler = new LibModulesHandler();
      assertEquals(handler.metadata.name, "LibModulesHandler");
    });

    it("should have priority defined", () => {
      const handler = new LibModulesHandler();
      assertExists(handler.metadata.priority);
      assertEquals(typeof handler.metadata.priority, "number");
    });

    it("should have two patterns (GET and HEAD)", () => {
      const handler = new LibModulesHandler();
      assertExists(handler.metadata.patterns);
      assertEquals(handler.metadata.patterns!.length, 2);
    });

    it("should match GET requests to /_veryfront/lib/", () => {
      const handler = new LibModulesHandler();
      const pattern = findPatternByMethod(handler, "GET");

      assertEquals(pattern.test("/_veryfront/lib/ai/react.js"), true);
      assertEquals(pattern.test("/_veryfront/lib/ai/components.js"), true);
      assertEquals(pattern.test("/_veryfront/lib/ai/primitives.js"), true);
    });

    it("should match HEAD requests to /_veryfront/lib/", () => {
      const handler = new LibModulesHandler();
      const pattern = findPatternByMethod(handler, "HEAD");

      assertEquals(pattern.test("/_veryfront/lib/ai/react.js"), true);
    });

    it("should not match other paths", () => {
      const handler = new LibModulesHandler();
      const pattern = findPatternByMethod(handler, "GET");

      assertEquals(pattern.test("/api/users"), false);
      assertEquals(pattern.test("/veryfront/lib/ai/react.js"), false);
      assertEquals(pattern.test("/"), false);
    });
  });

  describe("ALLOWED_MODULES whitelist", () => {
    it("should allow ai/react.js path pattern", () => {
      const handler = new LibModulesHandler();
      const pattern = getRegExpPattern(handler, 0);

      assertEquals(pattern.test("/_veryfront/lib/ai/react.js"), true);
    });

    it("should allow ai/components.js path pattern", () => {
      const handler = new LibModulesHandler();
      const pattern = getRegExpPattern(handler, 0);

      assertEquals(pattern.test("/_veryfront/lib/ai/components.js"), true);
    });

    it("should allow ai/primitives.js path pattern", () => {
      const handler = new LibModulesHandler();
      const pattern = getRegExpPattern(handler, 0);

      assertEquals(pattern.test("/_veryfront/lib/ai/primitives.js"), true);
    });
  });

  describe("URL pattern matching", () => {
    it("should match lib module path prefix", () => {
      const handler = new LibModulesHandler();
      const pattern = getRegExpPattern(handler, 0);

      assertEquals(pattern.test("/_veryfront/lib/"), true);
      assertEquals(pattern.test("/_veryfront/lib/anything"), true);
    });

    it("should not match paths without /_veryfront/lib/ prefix", () => {
      const handler = new LibModulesHandler();
      const pattern = getRegExpPattern(handler, 0);

      assertEquals(pattern.test("/veryfront/lib/ai/react.js"), false);
      assertEquals(pattern.test("/_veryfront/ai/react.js"), false);
      assertEquals(pattern.test("/lib/ai/react.js"), false);
    });

    it("should be case sensitive", () => {
      const handler = new LibModulesHandler();
      const pattern = getRegExpPattern(handler, 0);

      assertEquals(pattern.test("/_veryfront/lib/ai/react.js"), true);
      assertEquals(pattern.test("/_VERYFRONT/lib/ai/react.js"), false);
      assertEquals(pattern.test("/_Veryfront/lib/ai/react.js"), false);
    });
  });

  describe("handler instance", () => {
    it("should be instantiable", () => {
      const handler = new LibModulesHandler();
      assertExists(handler);
    });

    it("should have handle method", () => {
      const handler = new LibModulesHandler();
      assertEquals(typeof handler.handle, "function");
    });

    it("should extend BaseHandler", () => {
      const handler = new LibModulesHandler();
      assertExists(handler.metadata);
      assertExists(handler.handle);
    });
  });
});

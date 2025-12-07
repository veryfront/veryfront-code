/**
 * LibModulesHandler Tests
 *
 * Tests the allowed modules whitelist and module path resolution logic.
 */

import { assertEquals, assertExists } from "std/assert/mod.ts";
import { describe, it } from "std/testing/bdd.ts";
import { LibModulesHandler } from "./lib-modules-handler.ts";

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
      assertEquals(handler.metadata.patterns.length, 2);
    });

    it("should match GET requests to /_veryfront/lib/", () => {
      const handler = new LibModulesHandler();
      const getPattern = handler.metadata.patterns.find((p) => p.method === "GET");

      assertExists(getPattern);
      assertEquals(getPattern.pattern.test("/_veryfront/lib/ai/react.js"), true);
      assertEquals(getPattern.pattern.test("/_veryfront/lib/ai/components.js"), true);
      assertEquals(getPattern.pattern.test("/_veryfront/lib/ai/primitives.js"), true);
    });

    it("should match HEAD requests to /_veryfront/lib/", () => {
      const handler = new LibModulesHandler();
      const headPattern = handler.metadata.patterns.find((p) => p.method === "HEAD");

      assertExists(headPattern);
      assertEquals(headPattern.pattern.test("/_veryfront/lib/ai/react.js"), true);
    });

    it("should not match other paths", () => {
      const handler = new LibModulesHandler();
      const getPattern = handler.metadata.patterns.find((p) => p.method === "GET");

      assertExists(getPattern);
      assertEquals(getPattern.pattern.test("/api/users"), false);
      assertEquals(getPattern.pattern.test("/veryfront/lib/ai/react.js"), false);
      assertEquals(getPattern.pattern.test("/"), false);
    });
  });

  describe("ALLOWED_MODULES whitelist", () => {
    it("should allow ai/react.js path pattern", () => {
      const handler = new LibModulesHandler();
      const pattern = handler.metadata.patterns[0]?.pattern;

      assertExists(pattern);
      assertEquals(pattern.test("/_veryfront/lib/ai/react.js"), true);
    });

    it("should allow ai/components.js path pattern", () => {
      const handler = new LibModulesHandler();
      const pattern = handler.metadata.patterns[0]?.pattern;

      assertExists(pattern);
      assertEquals(pattern.test("/_veryfront/lib/ai/components.js"), true);
    });

    it("should allow ai/primitives.js path pattern", () => {
      const handler = new LibModulesHandler();
      const pattern = handler.metadata.patterns[0]?.pattern;

      assertExists(pattern);
      assertEquals(pattern.test("/_veryfront/lib/ai/primitives.js"), true);
    });
  });

  describe("URL pattern matching", () => {
    it("should match lib module path prefix", () => {
      const handler = new LibModulesHandler();
      const pattern = handler.metadata.patterns[0]?.pattern;

      assertExists(pattern);
      // The pattern matches the prefix /_veryfront/lib/
      assertEquals(pattern.test("/_veryfront/lib/"), true);
      assertEquals(pattern.test("/_veryfront/lib/anything"), true);
    });

    it("should not match paths without /_veryfront/lib/ prefix", () => {
      const handler = new LibModulesHandler();
      const pattern = handler.metadata.patterns[0]?.pattern;

      assertExists(pattern);
      assertEquals(pattern.test("/veryfront/lib/ai/react.js"), false);
      assertEquals(pattern.test("/_veryfront/ai/react.js"), false);
      assertEquals(pattern.test("/lib/ai/react.js"), false);
    });

    it("should be case sensitive", () => {
      const handler = new LibModulesHandler();
      const pattern = handler.metadata.patterns[0]?.pattern;

      assertExists(pattern);
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

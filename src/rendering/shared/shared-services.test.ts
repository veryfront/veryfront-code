import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertStrictEquals,
  assertStringIncludes,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import * as React from "react";
import {
  areSharedServicesInitialized,
  destroySharedServices,
  getSharedServices,
  initializeSharedServices,
} from "./shared-services.ts";
import { VeryfrontError } from "#veryfront/errors/index.ts";

describe("rendering/shared/shared-services", () => {
  describe("areSharedServicesInitialized", () => {
    it("should return a boolean", () => {
      const result = areSharedServicesInitialized();
      assertEquals(typeof result, "boolean");
    });
  });

  describe("getSharedServices before initialization", () => {
    it("should throw when not initialized", () => {
      destroySharedServices();
      const error = assertThrows(
        () => getSharedServices(),
        VeryfrontError,
      ) as VeryfrontError;
      assertEquals(
        error.slug,
        "initialization-error",
        "uninitialized access must raise the initialization error",
      );
      assertEquals(error.status, 500, "uninitialized access must map to HTTP 500");
      assertStringIncludes(
        error.detail ?? "",
        "Call initializeSharedServices() first",
        "the error must carry actionable guidance",
      );
    });
  });

  describe("destroySharedServices", () => {
    it("should not throw when called multiple times", () => {
      destroySharedServices();
      destroySharedServices();
      assertEquals(areSharedServicesInitialized(), false);
    });
  });

  describe("initializeSharedServices", () => {
    it("should initialize and return shared services", async () => {
      destroySharedServices();
      const services = await initializeSharedServices({ debugMode: false });
      assertEquals(typeof services.elementValidator, "object");
      assertEquals(typeof services.compilerService, "object");
      assertEquals(areSharedServicesInitialized(), true);
    });

    it("should return same instance on repeated calls", async () => {
      const s1 = await initializeSharedServices();
      const s2 = await initializeSharedServices();
      assertStrictEquals(
        s1,
        s2,
        "initializeSharedServices must return the identical singleton on repeated calls",
      );
      assertStrictEquals(
        s1.compilerService,
        getSharedServices().compilerService,
        "the object handed to callers must be the module singleton getSharedServices reads",
      );
    });

    it("should dedupe concurrent initialization", async () => {
      destroySharedServices();
      const [a, b] = await Promise.all([
        initializeSharedServices(),
        initializeSharedServices(),
      ]);
      assertStrictEquals(
        a,
        b,
        "concurrent callers must share one in-flight initialization promise",
      );
      assertStrictEquals(a, getSharedServices(), "the deduped result must be the module singleton");
    });

    it("should accept debug mode option", async () => {
      destroySharedServices();
      const services = await initializeSharedServices({ debugMode: true });
      assertEquals(typeof services.elementValidator, "object");
    });

    it("should accept custom maxValidationDepth", async () => {
      // An invalid child buried 25 levels down: reachable at depth 50, not at the default 20.
      let tree: unknown = { bad: 1 };
      for (let i = 0; i < 25; i++) {
        tree = React.createElement("div", null, tree as React.ReactNode);
      }

      destroySharedServices();
      const deep = await initializeSharedServices({ maxValidationDepth: 50 });
      assertThrows(
        () => deep.elementValidator.deepInspectElement(tree),
        Error,
        "Invalid React child",
        "maxValidationDepth: 50 must let inspection reach an invalid child 25 levels down",
      );

      destroySharedServices();
      const shallow = await initializeSharedServices({});
      shallow.elementValidator.deepInspectElement(tree);
    });

    it("should make getSharedServices work after initialization", async () => {
      destroySharedServices();
      await initializeSharedServices();
      const services = getSharedServices();
      assertEquals(typeof services.elementValidator, "object");
    });
  });
});

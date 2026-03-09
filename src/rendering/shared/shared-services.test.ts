import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
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
      assertThrows(
        () => getSharedServices(),
        VeryfrontError,
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
      assertEquals(s1, s2);
    });

    it("should accept debug mode option", async () => {
      destroySharedServices();
      const services = await initializeSharedServices({ debugMode: true });
      assertEquals(typeof services.elementValidator, "object");
    });

    it("should accept custom maxValidationDepth", async () => {
      destroySharedServices();
      const services = await initializeSharedServices({ maxValidationDepth: 50 });
      assertEquals(typeof services.elementValidator, "object");
    });

    it("should make getSharedServices work after initialization", async () => {
      destroySharedServices();
      await initializeSharedServices();
      const services = getSharedServices();
      assertEquals(typeof services.elementValidator, "object");
    });
  });
});

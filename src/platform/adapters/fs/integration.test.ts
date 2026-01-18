import { assertEquals, assertExists } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import {
  createFSAdapterFromConfig,
  enhanceAdapterWithFS,
  getFSAdapterType,
  isFSAdapterConfigured,
} from "./integration.ts";
import { denoAdapter } from "../deno.ts";

describe("integration.ts", () => {
  describe("enhanceAdapterWithFS", () => {
    it("should export enhanceAdapterWithFS function", () => {
      assertExists(enhanceAdapterWithFS);
      assertEquals(typeof enhanceAdapterWithFS, "function");
    });

    it("should return original adapter for local type", async () => {
      const adapter = await enhanceAdapterWithFS(denoAdapter, { fs: { type: "local" } });
      assertEquals(adapter, denoAdapter);
    });

    it("should return original adapter when no fs config", async () => {
      const adapter = await enhanceAdapterWithFS(denoAdapter, {});
      assertEquals(adapter, denoAdapter);
    });

    it("should return original adapter when fs.type is not set", async () => {
      const adapter = await enhanceAdapterWithFS(denoAdapter, { fs: {} });
      assertEquals(adapter, denoAdapter);
    });
  });

  describe("createFSAdapterFromConfig", () => {
    it("should export createFSAdapterFromConfig function", () => {
      assertExists(createFSAdapterFromConfig);
      assertEquals(typeof createFSAdapterFromConfig, "function");
    });

    it("should return null for local type", async () => {
      const adapter = await createFSAdapterFromConfig({ fs: { type: "local" } });
      assertEquals(adapter, null);
    });

    it("should return null when no fs config", async () => {
      const adapter = await createFSAdapterFromConfig({});
      assertEquals(adapter, null);
    });

    it("should return null when fs.type is not set", async () => {
      const adapter = await createFSAdapterFromConfig({ fs: {} });
      assertEquals(adapter, null);
    });
  });

  describe("isFSAdapterConfigured", () => {
    it("should export isFSAdapterConfigured function", () => {
      assertExists(isFSAdapterConfigured);
      assertEquals(typeof isFSAdapterConfigured, "function");
    });

    it("should return false for local type", () => {
      assertEquals(isFSAdapterConfigured({ fs: { type: "local" } }), false);
    });

    it("should return false when no fs config", () => {
      assertEquals(isFSAdapterConfigured({}), false);
    });

    it("should return false when fs.type is not set", () => {
      assertEquals(isFSAdapterConfigured({ fs: {} }), false);
    });

    it("should return true for veryfront-api type", () => {
      assertEquals(isFSAdapterConfigured({ fs: { type: "veryfront-api" } }), true);
    });

    it("should return true for github type", () => {
      assertEquals(isFSAdapterConfigured({ fs: { type: "github" } }), true);
    });
  });

  describe("getFSAdapterType", () => {
    it("should export getFSAdapterType function", () => {
      assertExists(getFSAdapterType);
      assertEquals(typeof getFSAdapterType, "function");
    });

    it("should return local as default", () => {
      assertEquals(getFSAdapterType({}), "local");
    });

    it("should return fs.type when set", () => {
      assertEquals(getFSAdapterType({ fs: { type: "veryfront-api" } }), "veryfront-api");
      assertEquals(getFSAdapterType({ fs: { type: "github" } }), "github");
    });

    it("should return local when fs.type is not set", () => {
      assertEquals(getFSAdapterType({ fs: {} }), "local");
    });
  });
});

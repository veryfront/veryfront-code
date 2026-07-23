import "#veryfront/schemas/_test-setup.ts";
import denoConfig from "#deno-config" with { type: "json" };
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createBuildVersion,
  normalizeVeryfrontVersion,
  resolveRuntimeVersion,
  RUNTIME_VERSION,
  SERVER_START_TIME,
  VERSION,
} from "./version.ts";

describe("version", () => {
  describe("VERSION", () => {
    it("should be a non-empty string", () => {
      assert(typeof VERSION === "string");
      assert(VERSION.length > 0);
    });

    it("should look like a semver version", () => {
      assert(/^\d+\.\d+\.\d+/.test(VERSION), `VERSION "${VERSION}" does not match semver pattern`);
    });

    it("should stay in sync with deno.json", () => {
      assertEquals(VERSION, denoConfig.version);
    });
  });

  describe("normalizeVeryfrontVersion", () => {
    it("strips a leading v from release tags", () => {
      assertEquals(normalizeVeryfrontVersion("v1.2.3"), "1.2.3");
    });

    it("preserves plain semver values", () => {
      assertEquals(normalizeVeryfrontVersion("1.2.3"), "1.2.3");
    });

    it("does not strip a leading v unless it prefixes a digit", () => {
      assertEquals(normalizeVeryfrontVersion("vnext"), "vnext");
    });

    it("trims valid identifiers and rejects unsafe values", () => {
      assertEquals(normalizeVeryfrontVersion("  v1.2.3-rc.1  "), "1.2.3-rc.1");
      assertEquals(normalizeVeryfrontVersion("../release"), undefined);
      assertEquals(normalizeVeryfrontVersion("1.2.3\nforged"), undefined);
      assertEquals(normalizeVeryfrontVersion("x".repeat(129)), undefined);
    });
  });

  describe("resolveRuntimeVersion", () => {
    it("prefers VERYFRONT_VERSION over other sources", () => {
      assertEquals(
        resolveRuntimeVersion({
          veryfrontVersion: "v1.2.3",
          releaseVersion: "v2.0.0",
          denoVersion: "3.0.0",
          fallbackVersion: "4.0.0",
        }),
        "1.2.3",
      );
    });

    it("falls back to release version before deno metadata", () => {
      assertEquals(
        resolveRuntimeVersion({
          releaseVersion: "v2.0.0",
          denoVersion: "3.0.0",
          fallbackVersion: "4.0.0",
        }),
        "2.0.0",
      );
    });

    it("falls back to deno metadata before the hard-coded fallback", () => {
      assertEquals(
        resolveRuntimeVersion({
          denoVersion: "3.0.0",
          fallbackVersion: "4.0.0",
        }),
        "3.0.0",
      );
    });

    it("falls back to VERSION when no explicit sources are available", () => {
      assertEquals(
        resolveRuntimeVersion({
          veryfrontVersion: undefined,
          releaseVersion: undefined,
          denoVersion: undefined,
          fallbackVersion: undefined,
        }),
        VERSION,
      );
    });

    it("skips invalid higher-priority sources and normalizes the explicit fallback", () => {
      assertEquals(
        resolveRuntimeVersion({
          veryfrontVersion: "../unsafe",
          releaseVersion: "v2.0.0",
          fallbackVersion: "v4.0.0",
        }),
        "2.0.0",
      );
      assertEquals(resolveRuntimeVersion({ fallbackVersion: "v4.0.0" }), "4.0.0");
    });
  });

  describe("SERVER_START_TIME", () => {
    it("should be a positive number", () => {
      assert(typeof SERVER_START_TIME === "number");
      assert(SERVER_START_TIME > 0);
    });

    it("should be a reasonable timestamp (after 2024)", () => {
      const year2024 = new Date("2024-01-01").getTime();
      assert(SERVER_START_TIME >= year2024, "SERVER_START_TIME should be after 2024");
    });
  });

  describe("createBuildVersion", () => {
    it("should return object with framework version", () => {
      assertEquals(createBuildVersion().framework, RUNTIME_VERSION);
    });

    it("should return object with server start time", () => {
      assertEquals(createBuildVersion().serverStart, SERVER_START_TIME);
    });

    it("should include projectUpdated when provided", () => {
      const timestamp = "2024-06-15T12:00:00Z";
      assertEquals(createBuildVersion(timestamp).projectUpdated, timestamp);
    });

    it("should have undefined projectUpdated when not provided", () => {
      assertEquals(createBuildVersion().projectUpdated, undefined);
    });
  });
});

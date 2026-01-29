import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createBuildVersion, SERVER_START_TIME, VERSION } from "./version.ts";

describe("version", () => {
  describe("VERSION", () => {
    it("should be a non-empty string", () => {
      assert(typeof VERSION === "string");
      assert(VERSION.length > 0);
    });

    it("should look like a semver version", () => {
      assert(/^\d+\.\d+\.\d+/.test(VERSION), `VERSION "${VERSION}" does not match semver pattern`);
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
      const build = createBuildVersion();
      assertEquals(build.framework, VERSION);
    });

    it("should return object with server start time", () => {
      const build = createBuildVersion();
      assertEquals(build.serverStart, SERVER_START_TIME);
    });

    it("should include projectUpdated when provided", () => {
      const timestamp = "2024-06-15T12:00:00Z";
      const build = createBuildVersion(timestamp);
      assertEquals(build.projectUpdated, timestamp);
    });

    it("should have undefined projectUpdated when not provided", () => {
      const build = createBuildVersion();
      assertEquals(build.projectUpdated, undefined);
    });
  });
});

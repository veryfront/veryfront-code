import { describe, it, beforeEach } from "std/testing/bdd.ts";
import { assert, assertExists } from "std/assert/mod.ts";
import { getGlobalTmpDir, resetGlobalTmpDir } from "./temp-directory.ts";

describe("temp-directory", () => {
  beforeEach(() => {
    resetGlobalTmpDir();
  });

  describe("getGlobalTmpDir", () => {
    it("should create and return a temporary directory", async () => {
      const tmpDir = await getGlobalTmpDir();

      assertExists(tmpDir);
      assert(tmpDir.length > 0);
      assert(tmpDir.includes("vf-modules"));
    });

    it("should return the same directory on multiple calls", async () => {
      const tmpDir1 = await getGlobalTmpDir();
      const tmpDir2 = await getGlobalTmpDir();

      assertExists(tmpDir1);
      assertExists(tmpDir2);
      assert(tmpDir1 === tmpDir2);
    });

    it("should include timestamp in directory name", async () => {
      const tmpDir = await getGlobalTmpDir();

      assertExists(tmpDir);
      assert(/vf-modules-\d+-/.test(tmpDir));
    });

    it("should include random string in directory name", async () => {
      const tmpDir = await getGlobalTmpDir();

      assertExists(tmpDir);
      assert(/vf-modules-\d+-[a-z0-9]+/.test(tmpDir));
    });
  });

  describe("resetGlobalTmpDir", () => {
    it("should reset the global tmp dir", async () => {
      const tmpDir1 = await getGlobalTmpDir();
      resetGlobalTmpDir();
      const tmpDir2 = await getGlobalTmpDir();

      assertExists(tmpDir1);
      assertExists(tmpDir2);
      assert(tmpDir1 !== tmpDir2);
    });

    it("should allow creating a new tmp dir after reset", async () => {
      await getGlobalTmpDir();
      resetGlobalTmpDir();
      const newTmpDir = await getGlobalTmpDir();

      assertExists(newTmpDir);
      assert(newTmpDir.length > 0);
    });
  });
});

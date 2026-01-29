import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { makeTempDir, remove } from "#veryfront/platform/compat/fs.ts";
import { detectPackageManager, getInstallCommand } from "./package-manager.ts";

describe("cli/utils/package-manager", () => {
  describe("getInstallCommand", () => {
    it("should return 'npm install' for npm", () => {
      assertEquals(getInstallCommand("npm"), "npm install");
    });

    it("should return 'yarn' for yarn", () => {
      assertEquals(getInstallCommand("yarn"), "yarn");
    });

    it("should return 'pnpm install' for pnpm", () => {
      assertEquals(getInstallCommand("pnpm"), "pnpm install");
    });

    it("should return 'bun install' for bun", () => {
      assertEquals(getInstallCommand("bun"), "bun install");
    });
  });

  describe("detectPackageManager", () => {
    it("should return preference when provided", async () => {
      const result = await detectPackageManager("/tmp/nonexistent", "pnpm");
      assertEquals(result, "pnpm");
    });

    it("should return npm as default when no lockfile found", async () => {
      const tempDir = await makeTempDir({ prefix: "pm-test-" });
      try {
        const result = await detectPackageManager(tempDir);
        assertEquals(result, "npm");
      } finally {
        await remove(tempDir, { recursive: true });
      }
    });

    it("should detect pnpm from pnpm-lock.yaml", async () => {
      const tempDir = await makeTempDir({ prefix: "pm-test-" });
      try {
        await Deno.writeTextFile(`${tempDir}/pnpm-lock.yaml`, "lockfileVersion: 5.4");
        const result = await detectPackageManager(tempDir);
        assertEquals(result, "pnpm");
      } finally {
        await remove(tempDir, { recursive: true });
      }
    });

    it("should detect yarn from yarn.lock", async () => {
      const tempDir = await makeTempDir({ prefix: "pm-test-" });
      try {
        await Deno.writeTextFile(`${tempDir}/yarn.lock`, "# yarn lockfile v1");
        const result = await detectPackageManager(tempDir);
        assertEquals(result, "yarn");
      } finally {
        await remove(tempDir, { recursive: true });
      }
    });

    it("should detect npm from package-lock.json", async () => {
      const tempDir = await makeTempDir({ prefix: "pm-test-" });
      try {
        await Deno.writeTextFile(`${tempDir}/package-lock.json`, "{}");
        const result = await detectPackageManager(tempDir);
        assertEquals(result, "npm");
      } finally {
        await remove(tempDir, { recursive: true });
      }
    });

    it("should prioritize bun over other lockfiles", async () => {
      const tempDir = await makeTempDir({ prefix: "pm-test-" });
      try {
        // bun.lockb is checked first
        await Deno.writeTextFile(`${tempDir}/bun.lockb`, "");
        await Deno.writeTextFile(`${tempDir}/package-lock.json`, "{}");
        const result = await detectPackageManager(tempDir);
        assertEquals(result, "bun");
      } finally {
        await remove(tempDir, { recursive: true });
      }
    });
  });
});

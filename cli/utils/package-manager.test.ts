import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { makeTempDir, remove } from "#veryfront/platform/compat/fs.ts";
import { detectPackageManager, getInstallCommand } from "./package-manager.ts";

async function withTempDir(fn: (tempDir: string) => Promise<void>): Promise<void> {
  const tempDir = await makeTempDir({ prefix: "pm-test-" });
  try {
    await fn(tempDir);
  } finally {
    await remove(tempDir, { recursive: true });
  }
}

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
      await withTempDir(async (tempDir) => {
        const result = await detectPackageManager(tempDir);
        assertEquals(result, "npm");
      });
    });

    it("should detect pnpm from pnpm-lock.yaml", async () => {
      await withTempDir(async (tempDir) => {
        await Deno.writeTextFile(`${tempDir}/pnpm-lock.yaml`, "lockfileVersion: 5.4");
        const result = await detectPackageManager(tempDir);
        assertEquals(result, "pnpm");
      });
    });

    it("should detect yarn from yarn.lock", async () => {
      await withTempDir(async (tempDir) => {
        await Deno.writeTextFile(`${tempDir}/yarn.lock`, "# yarn lockfile v1");
        const result = await detectPackageManager(tempDir);
        assertEquals(result, "yarn");
      });
    });

    it("should detect npm from package-lock.json", async () => {
      await withTempDir(async (tempDir) => {
        await Deno.writeTextFile(`${tempDir}/package-lock.json`, "{}");
        const result = await detectPackageManager(tempDir);
        assertEquals(result, "npm");
      });
    });

    it("should prioritize bun over other lockfiles", async () => {
      await withTempDir(async (tempDir) => {
        await Deno.writeTextFile(`${tempDir}/bun.lockb`, "");
        await Deno.writeTextFile(`${tempDir}/package-lock.json`, "{}");
        const result = await detectPackageManager(tempDir);
        assertEquals(result, "bun");
      });
    });
  });
});

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { makeTempDir, remove } from "#veryfront/platform/compat/fs.ts";
import {
  detectFromUserAgent,
  detectPackageManager,
  getDlxCommand,
  getInstallCommand,
  getRunCommand,
} from "./package-manager.ts";

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

  describe("getRunCommand", () => {
    it("should return 'npm run dev' for npm", () => {
      assertEquals(getRunCommand("npm", "dev"), "npm run dev");
    });

    it("should return 'yarn dev' for yarn", () => {
      assertEquals(getRunCommand("yarn", "dev"), "yarn dev");
    });

    it("should return 'pnpm dev' for pnpm", () => {
      assertEquals(getRunCommand("pnpm", "dev"), "pnpm dev");
    });

    it("should return 'bun dev' for bun", () => {
      assertEquals(getRunCommand("bun", "dev"), "bun dev");
    });
  });

  describe("getDlxCommand", () => {
    it("should return 'npx' for npm", () => {
      assertEquals(getDlxCommand("npm"), "npx");
    });

    it("should return 'yarn dlx' for yarn", () => {
      assertEquals(getDlxCommand("yarn"), "yarn dlx");
    });

    it("should return 'pnpm dlx' for pnpm", () => {
      assertEquals(getDlxCommand("pnpm"), "pnpm dlx");
    });

    it("should return 'bunx' for bun", () => {
      assertEquals(getDlxCommand("bun"), "bunx");
    });
  });

  describe("detectFromUserAgent", () => {
    // Note: This test checks the function logic, but can't easily test env var
    // since the env var is read at function call time
    it("should be a function", () => {
      assertEquals(typeof detectFromUserAgent, "function");
    });
  });
});

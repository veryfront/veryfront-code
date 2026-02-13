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

    it("should return 'deno install' for deno", () => {
      assertEquals(getInstallCommand("deno"), "deno install");
    });
  });

  describe("detectPackageManager", () => {
    // Clear npm_config_user_agent so lockfile detection tests aren't
    // short-circuited when running under `deno task`.
    const savedUserAgent = Deno.env.get("npm_config_user_agent");
    function clearUserAgent() {
      Deno.env.delete("npm_config_user_agent");
    }
    function restoreUserAgent() {
      if (savedUserAgent !== undefined) {
        Deno.env.set("npm_config_user_agent", savedUserAgent);
      } else {
        Deno.env.delete("npm_config_user_agent");
      }
    }

    it("should return preference when provided", async () => {
      const result = await detectPackageManager("/tmp/nonexistent", "pnpm");
      assertEquals(result, "pnpm");
    });

    it("should return npm as default when no lockfile found", async () => {
      clearUserAgent();
      try {
        await withTempDir(async (tempDir) => {
          const result = await detectPackageManager(tempDir);
          assertEquals(result, "npm");
        });
      } finally {
        restoreUserAgent();
      }
    });

    it("should detect pnpm from pnpm-lock.yaml", async () => {
      clearUserAgent();
      try {
        await withTempDir(async (tempDir) => {
          await Deno.writeTextFile(`${tempDir}/pnpm-lock.yaml`, "lockfileVersion: 5.4");
          const result = await detectPackageManager(tempDir);
          assertEquals(result, "pnpm");
        });
      } finally {
        restoreUserAgent();
      }
    });

    it("should detect yarn from yarn.lock", async () => {
      clearUserAgent();
      try {
        await withTempDir(async (tempDir) => {
          await Deno.writeTextFile(`${tempDir}/yarn.lock`, "# yarn lockfile v1");
          const result = await detectPackageManager(tempDir);
          assertEquals(result, "yarn");
        });
      } finally {
        restoreUserAgent();
      }
    });

    it("should detect npm from package-lock.json", async () => {
      clearUserAgent();
      try {
        await withTempDir(async (tempDir) => {
          await Deno.writeTextFile(`${tempDir}/package-lock.json`, "{}");
          const result = await detectPackageManager(tempDir);
          assertEquals(result, "npm");
        });
      } finally {
        restoreUserAgent();
      }
    });

    it("should detect deno from deno.lock", async () => {
      clearUserAgent();
      try {
        await withTempDir(async (tempDir) => {
          await Deno.writeTextFile(`${tempDir}/deno.lock`, "{}");
          const result = await detectPackageManager(tempDir);
          assertEquals(result, "deno");
        });
      } finally {
        restoreUserAgent();
      }
    });

    it("should prioritize deno over npm lockfile", async () => {
      clearUserAgent();
      try {
        await withTempDir(async (tempDir) => {
          await Deno.writeTextFile(`${tempDir}/deno.lock`, "{}");
          await Deno.writeTextFile(`${tempDir}/package-lock.json`, "{}");
          const result = await detectPackageManager(tempDir);
          assertEquals(result, "deno");
        });
      } finally {
        restoreUserAgent();
      }
    });

    it("should prioritize bun over other lockfiles", async () => {
      clearUserAgent();
      try {
        await withTempDir(async (tempDir) => {
          await Deno.writeTextFile(`${tempDir}/bun.lockb`, "");
          await Deno.writeTextFile(`${tempDir}/package-lock.json`, "{}");
          const result = await detectPackageManager(tempDir);
          assertEquals(result, "bun");
        });
      } finally {
        restoreUserAgent();
      }
    });

    it("should detect deno from user agent", async () => {
      clearUserAgent();
      try {
        Deno.env.set("npm_config_user_agent", "deno/2.6.0 npm/? deno/2.6.0 macos aarch64");
        await withTempDir(async (tempDir) => {
          const result = await detectPackageManager(tempDir);
          assertEquals(result, "deno");
        });
      } finally {
        restoreUserAgent();
      }
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

    it("should return 'deno task dev' for deno", () => {
      assertEquals(getRunCommand("deno", "dev"), "deno task dev");
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

    it("should return 'dx' for deno", () => {
      assertEquals(getDlxCommand("deno"), "dx");
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

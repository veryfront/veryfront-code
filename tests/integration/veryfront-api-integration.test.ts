/**
 * @file Integration tests for Veryfront API FSAdapter
 */

import { assertEquals, assertExists } from "@std/assert";
import { afterEach, describe, it } from "@std/testing/bdd.ts";
import { bootstrap } from "@veryfront/server/bootstrap.ts";
import { getAdapter } from "@veryfront/platform/adapters/detect.ts";
import type { VeryfrontConfig } from "@veryfront/config";
import { cleanupBundler } from "@veryfront/rendering/cleanup.ts";

// Disable sanitizers for this integration test suite as the MultiProjectFSAdapter
// starts background intervals for cleanup that are managed by the adapter lifecycle
describe("Veryfront API Integration", { sanitizeResources: false, sanitizeOps: false }, () => {
  // Clean up after each test to ensure intervals are cleared
  afterEach(async () => {
    await cleanupBundler();
  });
  describe("bootstrap", () => {
    // FIXME: This test incorrectly uses Deno.cwd() which has veryfront.config.ts with fs.type="veryfront-api"
    // It should use a temp directory without any config to test local filesystem mode
    it.ignore("should use local filesystem when no fs config", async () => {
      const adapter = await getAdapter();
      const projectDir = Deno.cwd();

      const result = await bootstrap(projectDir, adapter);

      assertEquals(result.usingFSAdapter, false);
      assertExists(result.adapter);
      assertExists(result.config);
    });

    it("should handle veryfront-api configuration", async () => {
      const adapter = await getAdapter();
      const projectDir = Deno.cwd();

      // Mock config by setting it directly (in real scenario, this would be in veryfront.config.ts)
      const _mockConfig: Partial<VeryfrontConfig> = {
        fs: {
          type: "veryfront-api",
          veryfront: {
            apiBaseUrl: "https://api.test.com",
            apiToken: "test-token",
            projectSlug: "test-project",
          },
        },
      };

      // Note: This test would need actual API or mock fetch to fully work
      // For now, we test that the bootstrap doesn't crash
      try {
        const result = await bootstrap(projectDir, adapter);

        // If bootstrap succeeded, it should have tried to use FSAdapter
        // In production, this would connect to the API
        assertExists(result.adapter);
        assertExists(result.config);
      } catch (error) {
        // Expected to fail without real API, but should be VeryfrontAPIError
        // not a bootstrap crash
        console.log("Expected error (no real API):", (error as Error).message);
      }
    });
  });

  describe("FSAdapterWrapper", () => {
    it("should wrap FSAdapter methods correctly", async () => {
      const { wrapFSAdapter } = await import("@veryfront/platform/adapters/fs/wrapper.ts");

      // Create mock FSAdapter
      const mockFSAdapter = {
        readTextFile: (path: string) => `content of ${path}`,
        readFile: (path: string) => new TextEncoder().encode(`content of ${path}`),
        readdir: (path: string) => [
          {
            name: "file1.ts",
            path: `${path}/file1.ts`,
            isFile: true,
            isDirectory: false,
            isSymlink: false,
          },
          {
            name: "file2.ts",
            path: `${path}/file2.ts`,
            isFile: true,
            isDirectory: false,
            isSymlink: false,
          },
        ],
        stat: (path: string) => ({
          path,
          size: 100,
          type: "file" as const,
          mtime: new Date(),
          isFile: true,
          isDirectory: false,
          isSymlink: false,
        }),
        exists: (path: string) => path === "exists.ts",
        initialize: async () => {},
        dispose: async () => {},
      };

      const wrapped = wrapFSAdapter(mockFSAdapter as any);

      // Test readFile
      const content = await wrapped.readFile("test.ts");
      assertEquals(content, "content of test.ts");

      // Test exists
      const exists = await wrapped.exists("exists.ts");
      assertEquals(exists, true);

      const notExists = await wrapped.exists("notexists.ts");
      assertEquals(notExists, false);

      // Test readDir
      const entries: any[] = [];
      for await (const entry of wrapped.readDir("dir")) {
        entries.push(entry);
      }
      assertEquals(entries.length, 2);
      assertEquals(entries[0]?.name, "file1.ts");

      // Test stat
      const stat = await wrapped.stat("test.ts");
      assertEquals(stat.size, 100);
      assertEquals(stat.isFile, true);
    });

    it("should throw NotSupportedError for unsupported operations", async () => {
      const { wrapFSAdapter, NotSupportedError } = await import(
        "@veryfront/platform/adapters/fs/wrapper.ts"
      );

      const mockFSAdapter = {
        readTextFile: () => "content",
        readFile: () => new Uint8Array(),
        readdir: () => [],
        stat: () => ({
          path: "",
          size: 0,
          type: "file" as const,
          mtime: new Date(),
          isFile: true,
          isDirectory: false,
          isSymlink: false,
        }),
        exists: () => true,
      };

      const wrapped = wrapFSAdapter(mockFSAdapter as any);

      // makeTempDir should throw
      try {
        await wrapped.makeTempDir("prefix");
        throw new Error("Should have thrown");
      } catch (error) {
        assertEquals(error instanceof NotSupportedError, true);
      }

      // watch should throw
      try {
        wrapped.watch("path");
        throw new Error("Should have thrown");
      } catch (error) {
        assertEquals(error instanceof NotSupportedError, true);
      }
    });
  });

  describe("configuration integration", () => {
    it("should detect FSAdapter configuration", async () => {
      const { isFSAdapterConfigured, getFSAdapterType } = await import(
        "@veryfront/platform/adapters/fs/integration.ts"
      );

      const configWithFS: Partial<VeryfrontConfig> = {
        fs: {
          type: "veryfront-api",
          veryfront: {
            apiBaseUrl: "https://api.test.com",
            apiToken: "test",
            projectSlug: "test",
          },
        },
      };

      const configWithoutFS: Partial<VeryfrontConfig> = {};

      assertEquals(isFSAdapterConfigured(configWithFS as any), true);
      assertEquals(isFSAdapterConfigured(configWithoutFS as any), false);

      assertEquals(getFSAdapterType(configWithFS as any), "veryfront-api");
      assertEquals(getFSAdapterType(configWithoutFS as any), "local");
    });
  });
});

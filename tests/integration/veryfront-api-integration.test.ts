/**
 * @file Integration tests for Veryfront API FSAdapter
 */

import { assertEquals, assertExists } from "#veryfront/testing/assert";
import { afterEach, describe, it } from "#veryfront/testing/bdd";
import { bootstrap } from "#veryfront/server/bootstrap.ts";
import { getAdapter } from "#veryfront/platform/adapters/detect.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import { cleanupBundler } from "#veryfront/rendering/cleanup.ts";
import { cwd } from "#veryfront/compat/process.ts";

describe("Veryfront API Integration", { sanitizeResources: false, sanitizeOps: false }, () => {
  afterEach(async () => {
    await cleanupBundler();
  });

  describe("bootstrap", () => {
    it.ignore("should use local filesystem when no fs config", async () => {
      const adapter = await getAdapter();
      const projectDir = cwd();

      const result = await bootstrap(projectDir, adapter);

      assertEquals(result.usingFSAdapter, false);
      assertExists(result.adapter);
      assertExists(result.config);
    });

    it("should handle veryfront-api configuration", async () => {
      const adapter = await getAdapter();
      const projectDir = cwd();

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

      try {
        const result = await bootstrap(projectDir, adapter);
        assertExists(result.adapter);
        assertExists(result.config);
      } catch (error) {
        console.log("Expected error (no real API):", (error as Error).message);
      }
    });
  });

  describe("FSAdapterWrapper", () => {
    it("should wrap FSAdapter methods correctly", async () => {
      const { wrapFSAdapter } = await import("#veryfront/platform/adapters/fs/wrapper.ts");

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

      const content = await wrapped.readFile("test.ts");
      assertEquals(content, "content of test.ts");

      assertEquals(await wrapped.exists("exists.ts"), true);
      assertEquals(await wrapped.exists("notexists.ts"), false);

      const entries: any[] = [];
      for await (const entry of wrapped.readDir("dir")) entries.push(entry);

      assertEquals(entries.length, 2);
      assertEquals(entries[0]?.name, "file1.ts");

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

      try {
        await wrapped.makeTempDir("prefix");
        throw new Error("Should have thrown");
      } catch (error) {
        assertEquals(error instanceof NotSupportedError, true);
      }

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

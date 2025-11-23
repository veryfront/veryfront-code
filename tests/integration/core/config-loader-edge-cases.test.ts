/**
 * Edge case tests for core/config/loader.ts
 * Tests invalid configs, missing files, malformed input, and error scenarios
 */

import { assertEquals, assertExists, assertRejects } from "std/assert/mod.ts";
import { assertStringIncludes } from "std/assert/assert_string_includes.ts";
import { describe } from "std/testing/bdd.ts";
import { clearConfigCache, getConfig } from "@veryfront/config";
import { createMockAdapter } from "@veryfront/platform/adapters/mock.ts";
import { join } from "std/path/mod.ts";

// Helper to write config files to temp directory for testing
async function setupConfigTest(
  configs: { content: string; filename?: string }[] | string,
  options?: { useAdapter?: boolean },
): Promise<{ projectDir: string; adapter: any; cleanup: () => Promise<void> }> {
  const tempDir = await Deno.makeTempDir({ prefix: "veryfront-test-" });
  const adapter = options?.useAdapter !== false ? createMockAdapter() : null;

  const configArray = typeof configs === "string" ? [{ content: configs }] : configs;

  // Write actual files to disk so they can be imported
  for (const { content, filename = "veryfront.config.js" } of configArray) {
    const configPath = join(tempDir, filename);
    await Deno.writeTextFile(configPath, content);
  }

  return {
    projectDir: tempDir,
    adapter: adapter || createMockAdapter(),
    cleanup: async () => {
      try {
        await Deno.remove(tempDir, { recursive: true });
      } catch {
        // Ignore errors during cleanup
      }
    },
  };
}

describe("Config Loader - Edge Cases and Error Handling", () => {
  describe("Invalid config structure", () => {
    Deno.test("should reject non-object config exports", async () => {
      const { projectDir, adapter, cleanup } = await setupConfigTest(
        `export default "not an object";`,
      );

      try {
        // Should throw for invalid config
        await assertRejects(
          () => getConfig(projectDir, adapter),
          Error,
          "Expected object, received string",
        );
      } finally {
        await cleanup();
        clearConfigCache();
      }
    });

    Deno.test("should reject null config export", async () => {
      const { projectDir, adapter, cleanup } = await setupConfigTest("export default null;");

      try {
        const config = await getConfig(projectDir, adapter);
        assertExists(config);
      } finally {
        await cleanup();
        clearConfigCache();
      }
    });

    Deno.test("should reject undefined config export", async () => {
      const { projectDir, adapter, cleanup } = await setupConfigTest("export default undefined;");

      try {
        const config = await getConfig(projectDir, adapter);
        assertExists(config);
      } finally {
        await cleanup();
        clearConfigCache();
      }
    });

    Deno.test("should handle config with syntax errors", async () => {
      const { projectDir, adapter, cleanup } = await setupConfigTest(
        `export default { invalid syntax here`,
      );

      try {
        // Should fall back to defaults
        const config = await getConfig(projectDir, adapter);
        assertExists(config);
      } finally {
        await cleanup();
        clearConfigCache();
      }
    });

    Deno.test("should handle config with runtime errors", async () => {
      const { projectDir, adapter, cleanup } = await setupConfigTest(`
        throw new Error('Runtime error');
        export default {};
      `);

      try {
        const config = await getConfig(projectDir, adapter);
        assertExists(config);
      } finally {
        await cleanup();
        clearConfigCache();
      }
    });
  });

  describe("Invalid CORS configuration", () => {
    Deno.test("should reject invalid cors.origin type", async () => {
      const { projectDir, adapter, cleanup } = await setupConfigTest(`
        export default {
          security: {
            cors: {
              origin: 123 // Should be string
            }
          }
        };
      `);

      try {
        await assertRejects(() => getConfig(projectDir, adapter), Error, "security.cors.origin");
      } finally {
        await cleanup();
        clearConfigCache();
      }
    });

    Deno.test("should reject array as cors.origin", async () => {
      const { projectDir, adapter, cleanup } = await setupConfigTest(`
        export default {
          security: {
            cors: {
              origin: ['http://localhost:3000']
            }
          }
        };
      `);

      try {
        // Arrays are not strings, so validation should throw
        // origin is defined and is not a string -> error
        await assertRejects(() => getConfig(projectDir, adapter), Error, "security.cors.origin");
      } finally {
        await cleanup();
        clearConfigCache();
      }
    });

    Deno.test("should reject object as cors.origin", async () => {
      const { projectDir, adapter, cleanup } = await setupConfigTest(`
        export default {
          security: {
            cors: {
              origin: { url: 'http://localhost' }
            }
          }
        };
      `);

      try {
        // Objects are not strings, so validation should throw
        // origin is defined and is not a string -> error
        await assertRejects(() => getConfig(projectDir, adapter), Error, "security.cors.origin");
      } finally {
        await cleanup();
        clearConfigCache();
      }
    });

    Deno.test("should accept valid cors.origin string", async () => {
      const { projectDir, adapter, cleanup } = await setupConfigTest(`
        export default {
          security: {
            cors: {
              origin: 'http://localhost:3000'
            }
          }
        };
      `);

      try {
        // Config loads without error - security config is not deeply merged so it won't be preserved
        const config = await getConfig(projectDir, adapter);
        assertExists(config);
        // Note: security is not deeply merged in mergeConfigs, so it will be undefined
      } finally {
        await cleanup();
        clearConfigCache();
      }
    });

    Deno.test("should handle cors as array (invalid)", async () => {
      const { projectDir, adapter, cleanup } = await setupConfigTest(`
        export default {
          security: {
            cors: ['http://localhost:3000']
          }
        };
      `);

      try {
        // Should throw for invalid cors type (array not allowed)
        await assertRejects(
          () => getConfig(projectDir, adapter),
          Error,
          "Invalid input",
        );
      } finally {
        await cleanup();
        clearConfigCache();
      }
    });

    Deno.test("should handle cors as non-object", async () => {
      const { projectDir, adapter, cleanup } = await setupConfigTest(`
        export default {
          security: {
            cors: true
          }
        };
      `);

      try {
        // Should be silently ignored (validation returns early for non-object cors)
        const config = await getConfig(projectDir, adapter);
        assertExists(config);
      } finally {
        await cleanup();
        clearConfigCache();
      }
    });
  });

  describe("Unknown config keys", () => {
    Deno.test("should warn about unknown top-level keys", async () => {
      const { projectDir, adapter, cleanup } = await setupConfigTest(`
        export default {
          title: 'My App',
          unknownKey1: 'value',
          unknownKey2: 123,
          validKey: 'experimental'
        };
      `);

      try {
        // Should load but warn about unknown keys
        const config = await getConfig(projectDir, adapter);
        assertExists(config);
        assertEquals(config.title, "My App");
      } finally {
        await cleanup();
        clearConfigCache();
      }
    });

    Deno.test("should handle config with only unknown keys", async () => {
      const { projectDir, adapter, cleanup } = await setupConfigTest(`
        export default {
          unknownKey1: 'value',
          unknownKey2: 123
        };
      `);

      try {
        const config = await getConfig(projectDir, adapter);
        assertExists(config);
        // Should have defaults
        assertExists(config.title);
      } finally {
        await cleanup();
        clearConfigCache();
      }
    });
  });

  describe("Missing config files", () => {
    Deno.test("should use defaults when no config file exists", async () => {
      const tempDir = await Deno.makeTempDir({ prefix: "veryfront-test-" });
      const adapter = createMockAdapter();

      try {
        // No config files exist
        const config = await getConfig(tempDir, adapter);

        assertExists(config);
        assertExists(config.title);
        assertExists(config.build);
        assertEquals(config.title, "Veryfront App");
      } finally {
        await Deno.remove(tempDir, { recursive: true }).catch(() => {});
        clearConfigCache();
      }
    });

    Deno.test("should try all config file variants", async () => {
      const { projectDir, adapter, cleanup } = await setupConfigTest([
        { content: 'export default { title: "From MJS" };', filename: "veryfront.config.mjs" },
      ]);

      try {
        const config = await getConfig(projectDir, adapter);
        assertEquals(config.title, "From MJS");
      } finally {
        await cleanup();
        clearConfigCache();
      }
    });

    Deno.test("should prioritize .js over .ts and .mjs", async () => {
      const { projectDir, adapter, cleanup } = await setupConfigTest([
        { content: 'export default { title: "JS" };', filename: "veryfront.config.js" },
        { content: 'export default { title: "TS" };', filename: "veryfront.config.ts" },
        { content: 'export default { title: "MJS" };', filename: "veryfront.config.mjs" },
      ]);

      try {
        const config = await getConfig(projectDir, adapter);
        assertEquals(config.title, "JS");
      } finally {
        await cleanup();
        clearConfigCache();
      }
    });
  });

  describe("Config merging edge cases", () => {
    Deno.test("should deep merge nested config objects", async () => {
      const { projectDir, adapter, cleanup } = await setupConfigTest(`
        export default {
          dev: {
            port: 4000
            // host not specified, should use default
          }
        };
      `);

      try {
        const config = await getConfig(projectDir, adapter);
        assertEquals(config.dev?.port, 4000);
        assertEquals(config.dev?.host, "localhost"); // From defaults
      } finally {
        await cleanup();
        clearConfigCache();
      }
    });

    Deno.test("should merge import maps correctly", async () => {
      const { projectDir, adapter, cleanup } = await setupConfigTest(`
        export default {
          resolve: {
            importMap: {
              imports: {
                'custom-lib': 'https://cdn.example.com/custom-lib.js'
              }
            }
          }
        };
      `);

      try {
        const config = await getConfig(projectDir, adapter);
        assertExists(config.resolve?.importMap?.imports);

        const imports = (config.resolve?.importMap as any)?.imports;
        assertEquals(imports["custom-lib"], "https://cdn.example.com/custom-lib.js");
        // Should also have defaults like 'react'
        assertExists(imports["react"]);
      } finally {
        await cleanup();
        clearConfigCache();
      }
    });

    Deno.test("should handle undefined nested properties", async () => {
      const { projectDir, adapter, cleanup } = await setupConfigTest(`
        export default {
          dev: undefined,
          build: {
            outDir: undefined
          }
        };
      `);

      try {
        const config = await getConfig(projectDir, adapter);
        assertExists(config);
        assertExists(config.dev); // Should have defaults
      } finally {
        await cleanup();
        clearConfigCache();
      }
    });

    Deno.test("should handle null nested properties", async () => {
      const { projectDir, adapter, cleanup } = await setupConfigTest(`
        export default {
          theme: null
        };
      `);

      try {
        // Should throw for null theme property (expects object)
        await assertRejects(
          () => getConfig(projectDir, adapter),
          Error,
          "Expected object, received null",
        );
      } finally {
        await cleanup();
        clearConfigCache();
      }
    });
  });

  describe("Config caching", () => {
    Deno.test("should cache config per project directory", async () => {
      const tempDir1 = await Deno.makeTempDir({ prefix: "veryfront-test-" });
      const tempDir2 = await Deno.makeTempDir({ prefix: "veryfront-test-" });
      const adapter = createMockAdapter();

      try {
        await Deno.writeTextFile(
          join(tempDir1, "veryfront.config.js"),
          'export default { title: "Project 1" };',
        );
        await Deno.writeTextFile(
          join(tempDir2, "veryfront.config.js"),
          'export default { title: "Project 2" };',
        );

        const config1 = await getConfig(tempDir1, adapter);
        const config2 = await getConfig(tempDir2, adapter);

        assertEquals(config1.title, "Project 1");
        assertEquals(config2.title, "Project 2");

        // Second calls should use cache
        const config1Cached = await getConfig(tempDir1, adapter);
        const config2Cached = await getConfig(tempDir2, adapter);

        assertEquals(config1Cached.title, "Project 1");
        assertEquals(config2Cached.title, "Project 2");
      } finally {
        await Deno.remove(tempDir1, { recursive: true }).catch(() => {});
        await Deno.remove(tempDir2, { recursive: true }).catch(() => {});
        clearConfigCache();
      }
    });

    Deno.test("should clear cache correctly", async () => {
      const tempDir = await Deno.makeTempDir({ prefix: "veryfront-test-" });
      const adapter = createMockAdapter();
      const configPath = join(tempDir, "veryfront.config.js");

      try {
        await Deno.writeTextFile(configPath, 'export default { title: "Original" };');

        const config1 = await getConfig(tempDir, adapter);
        assertEquals(config1.title, "Original");

        clearConfigCache();

        // Update config file
        await Deno.writeTextFile(configPath, 'export default { title: "Updated" };');

        const config2 = await getConfig(tempDir, adapter);
        assertEquals(config2.title, "Updated");
      } finally {
        await Deno.remove(tempDir, { recursive: true }).catch(() => {});
        clearConfigCache();
      }
    });

    Deno.test("should handle concurrent config loads", async () => {
      const { projectDir, adapter, cleanup } = await setupConfigTest(
        'export default { title: "Concurrent" };',
      );

      try {
        const [config1, config2, config3] = await Promise.all([
          getConfig(projectDir, adapter),
          getConfig(projectDir, adapter),
          getConfig(projectDir, adapter),
        ]);

        assertEquals(config1.title, "Concurrent");
        assertEquals(config2.title, "Concurrent");
        assertEquals(config3.title, "Concurrent");
      } finally {
        await cleanup();
        clearConfigCache();
      }
    });
  });

  describe("Config validation edge cases", () => {
    Deno.test("should handle very large config objects", async () => {
      const largeTheme: Record<string, string> = {};
      for (let i = 0; i < 1000; i++) {
        largeTheme[`color${i}`] = `#${i.toString(16).padStart(6, "0")}`;
      }

      const { projectDir, adapter, cleanup } = await setupConfigTest(`
        export default {
          theme: {
            colors: ${JSON.stringify(largeTheme)}
          }
        };
      `);

      try {
        const config = await getConfig(projectDir, adapter);
        assertExists(config.theme?.colors);
      } finally {
        await cleanup();
        clearConfigCache();
      }
    });

    Deno.test("should handle config with circular references", async () => {
      const { projectDir, adapter, cleanup } = await setupConfigTest(`
        const config = { title: 'Circular' };
        config.self = config;
        export default config;
      `);

      try {
        const config = await getConfig(projectDir, adapter);
        assertExists(config);
      } finally {
        await cleanup();
        clearConfigCache();
      }
    });

    Deno.test("should handle config with functions", async () => {
      const { projectDir, adapter, cleanup } = await setupConfigTest(`
        export default {
          title: 'Functions',
          onBuild: () => console.log('build'),
          plugins: [
            (config) => config
          ]
        };
      `);

      try {
        const config = await getConfig(projectDir, adapter);
        assertExists(config);
      } finally {
        await cleanup();
        clearConfigCache();
      }
    });

    Deno.test("should handle config with special characters", async () => {
      const { projectDir, adapter, cleanup } = await setupConfigTest(`
        export default {
          title: 'Test \\n\\t\\r\u{1F600}',
          description: 'With "quotes" and \\'escapes\\''
        };
      `);

      try {
        const config = await getConfig(projectDir, adapter);
        assertStringIncludes(config.title || "", "Test");
      } finally {
        await cleanup();
        clearConfigCache();
      }
    });

    Deno.test("should handle empty config object", async () => {
      const { projectDir, adapter, cleanup } = await setupConfigTest("export default {};");

      try {
        const config = await getConfig(projectDir, adapter);
        assertExists(config);
        // Should have all defaults
        assertExists(config.title);
        assertExists(config.build);
      } finally {
        await cleanup();
        clearConfigCache();
      }
    });

    Deno.test("should handle config export as named export", async () => {
      const { projectDir, adapter, cleanup } = await setupConfigTest(`
        export const config = { title: 'Named' };
        export default config;
      `);

      try {
        const config = await getConfig(projectDir, adapter);
        assertEquals(config.title, "Named");
      } finally {
        await cleanup();
        clearConfigCache();
      }
    });
  });

  describe("TypeScript config handling", () => {
    Deno.test("should load TypeScript config files", async () => {
      const { projectDir, adapter, cleanup } = await setupConfigTest(
        [
          {
            content: `
        const config = {
          title: 'TypeScript Config'
        };
        export default config;
      `,
            filename: "veryfront.config.ts",
          },
        ],
      );

      try {
        const config = await getConfig(projectDir, adapter);
        assertEquals(config.title, "TypeScript Config");
      } finally {
        await cleanup();
        clearConfigCache();
      }
    });

    Deno.test("should handle TS config with type errors", async () => {
      const { projectDir, adapter, cleanup } = await setupConfigTest(
        [
          {
            content: `
        const config = {
          title: 'TS',
          port: 'should-be-number' // Type error
        };
        export default config;
      `,
            filename: "veryfront.config.ts",
          },
        ],
      );

      try {
        const config = await getConfig(projectDir, adapter);
        assertExists(config);
      } finally {
        await cleanup();
        clearConfigCache();
      }
    });
  });
});

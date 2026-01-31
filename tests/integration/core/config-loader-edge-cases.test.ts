/**
 * Edge case tests for core/config/loader.ts
 * Tests invalid configs, missing files, malformed input, and error scenarios
 */

import { assertEquals, assertExists, assertRejects } from "@veryfront/testing/assert";
import { assertStringIncludes } from "@veryfront/testing/assert";
import { describe, it } from "@veryfront/testing/bdd";
import { clearConfigCache, getConfig } from "@veryfront/config";
import { createMockAdapter } from "@veryfront/platform/adapters/mock.ts";
import { join } from "@veryfront/compat/path";
import { makeTempDir, remove, writeTextFile } from "@veryfront/testing/deno-compat";

type SetupResult = {
  projectDir: string;
  adapter: any;
  cleanup: () => Promise<void>;
};

async function setupConfigTest(
  configs: { content: string; filename?: string }[] | string,
  options?: { useAdapter?: boolean },
): Promise<SetupResult> {
  const tempDir = await makeTempDir({ prefix: "veryfront-test-" });
  const adapter = options?.useAdapter === false ? null : createMockAdapter();
  const configArray = typeof configs === "string" ? [{ content: configs }] : configs;

  for (const { content, filename = "veryfront.config.js" } of configArray) {
    const configPath = join(tempDir, filename);
    await writeTextFile(configPath, content);
    await adapter?.fs.writeFile(configPath, content);
  }

  return {
    projectDir: tempDir,
    adapter: adapter ?? createMockAdapter(),
    cleanup: async () => {
      await remove(tempDir, { recursive: true }).catch(() => {});
    },
  };
}

async function withConfigTest(
  configs: { content: string; filename?: string }[] | string,
  fn: (ctx: { projectDir: string; adapter: any }) => Promise<void>,
  options?: { useAdapter?: boolean },
): Promise<void> {
  const { projectDir, adapter, cleanup } = await setupConfigTest(configs, options);

  try {
    await fn({ projectDir, adapter });
  } finally {
    await cleanup();
    clearConfigCache();
  }
}

describe("Config Loader - Edge Cases and Error Handling", () => {
  describe("Invalid config structure", () => {
    it("should reject non-object config exports", async () => {
      await withConfigTest(`export default "not an object";`, async ({ projectDir, adapter }) => {
        await assertRejects(
          () => getConfig(projectDir, adapter),
          Error,
          "Expected object, received string",
        );
      });
    });

    it("should reject null config export", async () => {
      await withConfigTest("export default null;", async ({ projectDir, adapter }) => {
        await assertRejects(() => getConfig(projectDir, adapter), Error, "Unknown config keys");
      });
    });

    it("should reject undefined config export", async () => {
      await withConfigTest("export default undefined;", async ({ projectDir, adapter }) => {
        await assertRejects(() => getConfig(projectDir, adapter), Error, "Unknown config keys");
      });
    });

    it("should handle config with syntax errors", async () => {
      await withConfigTest(
        `export default { invalid syntax here`,
        async ({ projectDir, adapter }) => {
          const config = await getConfig(projectDir, adapter);
          assertExists(config);
        },
      );
    });

    it("should handle config with runtime errors", async () => {
      await withConfigTest(
        `
        throw new Error('Runtime error');
        export default {};
      `,
        async ({ projectDir, adapter }) => {
          const config = await getConfig(projectDir, adapter);
          assertExists(config);
        },
      );
    });
  });

  describe("Invalid CORS configuration", () => {
    it("should reject invalid cors.origin type", async () => {
      await withConfigTest(
        `
        export default {
          security: {
            cors: {
              origin: 123 // Should be string
            }
          }
        };
      `,
        async ({ projectDir, adapter }) => {
          await assertRejects(() => getConfig(projectDir, adapter), Error, "security.cors.origin");
        },
      );
    });

    it("should reject array as cors.origin", async () => {
      await withConfigTest(
        `
        export default {
          security: {
            cors: {
              origin: ['http://localhost:3000']
            }
          }
        };
      `,
        async ({ projectDir, adapter }) => {
          await assertRejects(() => getConfig(projectDir, adapter), Error, "security.cors.origin");
        },
      );
    });

    it("should reject object as cors.origin", async () => {
      await withConfigTest(
        `
        export default {
          security: {
            cors: {
              origin: { url: 'http://localhost' }
            }
          }
        };
      `,
        async ({ projectDir, adapter }) => {
          await assertRejects(() => getConfig(projectDir, adapter), Error, "security.cors.origin");
        },
      );
    });

    it("should accept valid cors.origin string", async () => {
      await withConfigTest(
        `
        export default {
          security: {
            cors: {
              origin: 'http://localhost:3000'
            }
          }
        };
      `,
        async ({ projectDir, adapter }) => {
          const config = await getConfig(projectDir, adapter);
          assertExists(config);
        },
      );
    });

    it("should handle cors as array (invalid)", async () => {
      await withConfigTest(
        `
        export default {
          security: {
            cors: ['http://localhost:3000']
          }
        };
      `,
        async ({ projectDir, adapter }) => {
          await assertRejects(() => getConfig(projectDir, adapter), Error, "Invalid input");
        },
      );
    });

    it("should handle cors as non-object", async () => {
      await withConfigTest(
        `
        export default {
          security: {
            cors: true
          }
        };
      `,
        async ({ projectDir, adapter }) => {
          const config = await getConfig(projectDir, adapter);
          assertExists(config);
        },
      );
    });
  });

  describe("Unknown config keys", () => {
    it("should reject unknown top-level keys", async () => {
      await withConfigTest(
        `
        export default {
          title: 'My App',
          unknownKey1: 'value',
          unknownKey2: 123,
          validKey: 'experimental'
        };
      `,
        async ({ projectDir, adapter }) => {
          await assertRejects(() => getConfig(projectDir, adapter), Error, "Unknown config keys");
        },
      );
    });

    it("should reject config with only unknown keys", async () => {
      await withConfigTest(
        `
        export default {
          unknownKey1: 'value',
          unknownKey2: 123
        };
      `,
        async ({ projectDir, adapter }) => {
          await assertRejects(() => getConfig(projectDir, adapter), Error, "Unknown config keys");
        },
      );
    });
  });

  describe("Missing config files", () => {
    it("should use defaults when no config file exists", async () => {
      const tempDir = await makeTempDir({ prefix: "veryfront-test-" });
      const adapter = createMockAdapter();

      try {
        const config = await getConfig(tempDir, adapter);

        assertExists(config);
        assertExists(config.title);
        assertExists(config.build);
        assertEquals(config.title, "Veryfront App");
      } finally {
        await remove(tempDir, { recursive: true }).catch(() => {});
        clearConfigCache();
      }
    });

    it("should try all config file variants", async () => {
      await withConfigTest(
        [{ content: 'export default { title: "From MJS" };', filename: "veryfront.config.mjs" }],
        async ({ projectDir, adapter }) => {
          const config = await getConfig(projectDir, adapter);
          assertEquals(config.title, "From MJS");
        },
      );
    });

    it("should prioritize .js over .ts and .mjs", async () => {
      await withConfigTest(
        [
          { content: 'export default { title: "JS" };', filename: "veryfront.config.js" },
          { content: 'export default { title: "TS" };', filename: "veryfront.config.ts" },
          { content: 'export default { title: "MJS" };', filename: "veryfront.config.mjs" },
        ],
        async ({ projectDir, adapter }) => {
          const config = await getConfig(projectDir, adapter);
          assertEquals(config.title, "JS");
        },
      );
    });
  });

  describe("Config merging edge cases", () => {
    it("should deep merge nested config objects", async () => {
      await withConfigTest(
        `
        export default {
          dev: {
            port: 4000
            // host not specified, should use default
          }
        };
      `,
        async ({ projectDir, adapter }) => {
          const config = await getConfig(projectDir, adapter);
          assertEquals(config.dev?.port, 4000);
          assertEquals(config.dev?.host, "localhost");
        },
      );
    });

    it("should merge import maps correctly", async () => {
      await withConfigTest(
        `
        export default {
          resolve: {
            importMap: {
              imports: {
                'custom-lib': 'https://cdn.example.com/custom-lib.js'
              }
            }
          }
        };
      `,
        async ({ projectDir, adapter }) => {
          const config = await getConfig(projectDir, adapter);
          const imports = config.resolve?.importMap?.imports;

          assertExists(imports);
          assertEquals(imports["custom-lib"], "https://cdn.example.com/custom-lib.js");
          assertExists(imports["react"]);
        },
      );
    });

    it("should handle undefined nested properties", async () => {
      await withConfigTest(
        `
        export default {
          dev: undefined,
          build: {
            outDir: undefined
          }
        };
      `,
        async ({ projectDir, adapter }) => {
          const config = await getConfig(projectDir, adapter);
          assertExists(config);
          assertExists(config.dev);
        },
      );
    });

    it("should handle null nested properties", async () => {
      await withConfigTest(
        `
        export default {
          theme: null
        };
      `,
        async ({ projectDir, adapter }) => {
          await assertRejects(
            () => getConfig(projectDir, adapter),
            Error,
            "Expected object, received null",
          );
        },
      );
    });
  });

  describe("Config caching", () => {
    it("should cache config per project directory", async () => {
      const tempDir1 = await makeTempDir({ prefix: "veryfront-test-" });
      const tempDir2 = await makeTempDir({ prefix: "veryfront-test-" });
      const adapter = createMockAdapter();

      try {
        const configPath1 = join(tempDir1, "veryfront.config.js");
        const configPath2 = join(tempDir2, "veryfront.config.js");

        await writeTextFile(configPath1, 'export default { title: "Project 1" };');
        await adapter.fs.writeFile(configPath1, 'export default { title: "Project 1" };');

        await writeTextFile(configPath2, 'export default { title: "Project 2" };');
        await adapter.fs.writeFile(configPath2, 'export default { title: "Project 2" };');

        const config1 = await getConfig(tempDir1, adapter);
        const config2 = await getConfig(tempDir2, adapter);

        assertEquals(config1.title, "Project 1");
        assertEquals(config2.title, "Project 2");

        const config1Cached = await getConfig(tempDir1, adapter);
        const config2Cached = await getConfig(tempDir2, adapter);

        assertEquals(config1Cached.title, "Project 1");
        assertEquals(config2Cached.title, "Project 2");
      } finally {
        await remove(tempDir1, { recursive: true }).catch(() => {});
        await remove(tempDir2, { recursive: true }).catch(() => {});
        clearConfigCache();
      }
    });

    it("should clear cache correctly", async () => {
      const tempDir = await makeTempDir({ prefix: "veryfront-test-" });
      const adapter = createMockAdapter();
      const configPath = join(tempDir, "veryfront.config.js");

      try {
        await writeTextFile(configPath, 'export default { title: "Original" };');
        await adapter.fs.writeFile(configPath, 'export default { title: "Original" };');

        const config1 = await getConfig(tempDir, adapter);
        assertEquals(config1.title, "Original");

        clearConfigCache();

        await writeTextFile(configPath, 'export default { title: "Updated" };');
        await adapter.fs.writeFile(configPath, 'export default { title: "Updated" };');

        const config2 = await getConfig(tempDir, adapter);
        assertEquals(config2.title, "Updated");
      } finally {
        await remove(tempDir, { recursive: true }).catch(() => {});
        clearConfigCache();
      }
    });

    it("should handle concurrent config loads", async () => {
      await withConfigTest('export default { title: "Concurrent" };', async ({ projectDir, adapter }) => {
        const [config1, config2, config3] = await Promise.all([
          getConfig(projectDir, adapter),
          getConfig(projectDir, adapter),
          getConfig(projectDir, adapter),
        ]);

        assertEquals(config1.title, "Concurrent");
        assertEquals(config2.title, "Concurrent");
        assertEquals(config3.title, "Concurrent");
      });
    });
  });

  describe("Config validation edge cases", () => {
    it("should handle very large config objects", async () => {
      const largeTheme: Record<string, string> = {};
      for (let i = 0; i < 1000; i++) {
        largeTheme[`color${i}`] = `#${i.toString(16).padStart(6, "0")}`;
      }

      await withConfigTest(
        `
        export default {
          theme: {
            colors: ${JSON.stringify(largeTheme)}
          }
        };
      `,
        async ({ projectDir, adapter }) => {
          const config = await getConfig(projectDir, adapter);
          assertExists(config.theme?.colors);
        },
      );
    });

    it("should reject config with circular references containing unknown keys", async () => {
      await withConfigTest(
        `
        const config = { title: 'Circular' };
        config.self = config;
        export default config;
      `,
        async ({ projectDir, adapter }) => {
          await assertRejects(
            () => getConfig(projectDir, adapter),
            Error,
            "Unknown config keys: self",
          );
        },
      );
    });

    it("should reject config with unknown function keys", async () => {
      await withConfigTest(
        `
        export default {
          title: 'Functions',
          onBuild: () => console.log('build'),
          plugins: [
            (config) => config
          ]
        };
      `,
        async ({ projectDir, adapter }) => {
          await assertRejects(() => getConfig(projectDir, adapter), Error, "Unknown config keys");
        },
      );
    });

    it("should handle config with special characters", async () => {
      await withConfigTest(
        `
        export default {
          title: 'Test \\n\\t\\r\u{1F600}',
          description: 'With "quotes" and \\'escapes\\''
        };
      `,
        async ({ projectDir, adapter }) => {
          const config = await getConfig(projectDir, adapter);
          assertStringIncludes(config.title || "", "Test");
        },
      );
    });

    it("should handle empty config object", async () => {
      await withConfigTest("export default {};", async ({ projectDir, adapter }) => {
        const config = await getConfig(projectDir, adapter);
        assertExists(config);
        assertExists(config.title);
        assertExists(config.build);
      });
    });

    it("should handle config export as named export", async () => {
      await withConfigTest(
        `
        export const config = { title: 'Named' };
        export default config;
      `,
        async ({ projectDir, adapter }) => {
          const config = await getConfig(projectDir, adapter);
          assertEquals(config.title, "Named");
        },
      );
    });
  });

  describe("TypeScript config handling", () => {
    it("should load TypeScript config files", async () => {
      await withConfigTest(
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
        async ({ projectDir, adapter }) => {
          const config = await getConfig(projectDir, adapter);
          assertEquals(config.title, "TypeScript Config");
        },
      );
    });

    it("should reject TS config with unknown keys", async () => {
      await withConfigTest(
        [
          {
            content: `
        const config = {
          title: 'TS',
          port: 'should-be-number'
        };
        export default config;
      `,
            filename: "veryfront.config.ts",
          },
        ],
        async ({ projectDir, adapter }) => {
          await assertRejects(
            () => getConfig(projectDir, adapter),
            Error,
            "Unknown config keys: port",
          );
        },
      );
    });
  });
});

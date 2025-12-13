
import { assert, assertEquals, assertExists, assertRejects } from "std/assert/mod.ts";
import { afterEach, describe, it } from "std/testing/bdd.ts";
import { bootstrap, bootstrapDev, bootstrapProd } from "../../../src/server/bootstrap.ts";
import { clearConfigCache } from "@veryfront/config";
import { join } from "std/path/mod.ts";
import { denoAdapter } from "@veryfront/platform/adapters/deno.ts";


async function createTempDir(prefix: string): Promise<string> {
  return await Deno.makeTempDir({ prefix: `bootstrap_test_${prefix}_` });
}

async function cleanupTempDir(dir: string): Promise<void> {
  try {
    await Deno.remove(dir, { recursive: true });
  } catch {
    // Ignore cleanup errors
  }
}

async function writeConfigFile(
  projectDir: string,
  filename: string,
  content: string,
): Promise<void> {
  await Deno.writeTextFile(join(projectDir, filename), content);
}

function createBasicConfig(options: {
  title?: string;
  fsType?: string;
  projectSlug?: string;
  apiKey?: string;
  [key: string]: any;
} = {}): string {
  const config: any = {
    title: options.title || "Test Bootstrap App",
    description: "Testing bootstrap module",
    ...options,
  };

  if (options.fsType && options.fsType !== "local") {
    config.fs = {
      type: options.fsType,
      veryfront: {
        projectSlug: options.projectSlug || "test-project",
        apiKey: options.apiKey || "test-api-key",
      },
    };
  }

  delete config.fsType;
  delete config.projectSlug;
  delete config.apiKey;

  return `export default ${JSON.stringify(config, null, 2)};`;
}


describe("bootstrap - Basic Flow", () => {
  afterEach(() => {
    clearConfigCache();
  });

  it("should initialize with default config when no config file exists", async () => {
    const adapter = denoAdapter;
    const projectDir = await createTempDir("default");

    try {
      const result = await bootstrap(projectDir, adapter);

      assertExists(result);
      assertExists(result.adapter);
      assertExists(result.config);
      assertEquals(result.usingFSAdapter, false);
      assertEquals(result.config.title, "Veryfront App");
    } finally {
      await cleanupTempDir(projectDir);
    }
  });

  it("should initialize with custom config from veryfront.config.js", async () => {
    const adapter = denoAdapter;
    const projectDir = await createTempDir("custom");

    try {
      await writeConfigFile(projectDir, "veryfront.config.js", createBasicConfig());

      const result = await bootstrap(projectDir, adapter);

      assertExists(result);
      assertEquals(result.config.title, "Test Bootstrap App");
      assertEquals(result.usingFSAdapter, false);
    } finally {
      await cleanupTempDir(projectDir);
    }
  });

  it("should initialize with custom projectDir path", async () => {
    const adapter = denoAdapter;
    const projectDir = await createTempDir("custom_path");

    try {
      await writeConfigFile(projectDir, "veryfront.config.js", createBasicConfig());

      const result = await bootstrap(projectDir, adapter);

      assertExists(result);
      assertEquals(result.config.title, "Test Bootstrap App");
    } finally {
      await cleanupTempDir(projectDir);
    }
  });

  it('should use local filesystem when fs.type is "local"', async () => {
    const adapter = denoAdapter;
    const projectDir = await createTempDir("local_fs");

    try {
      await writeConfigFile(
        projectDir,
        "veryfront.config.js",
        `export default { title: 'Local FS App', fs: { type: 'local' } };`,
      );

      const result = await bootstrap(projectDir, adapter);

      assertEquals(result.usingFSAdapter, false);
      assertEquals(result.fsAdapterType, undefined);
    } finally {
      await cleanupTempDir(projectDir);
    }
  });

  it("should use local filesystem when fs is not configured", async () => {
    const adapter = denoAdapter;
    const projectDir = await createTempDir("no_fs");

    try {
      await writeConfigFile(
        projectDir,
        "veryfront.config.js",
        `export default { title: 'No FS Config' };`,
      );

      const result = await bootstrap(projectDir, adapter);

      assertEquals(result.usingFSAdapter, false);
      assertEquals(result.fsAdapterType, undefined);
    } finally {
      await cleanupTempDir(projectDir);
    }
  });

  it("should return same adapter when using local filesystem", async () => {
    const adapter = denoAdapter;
    const projectDir = await createTempDir("same_adapter");

    try {
      await writeConfigFile(projectDir, "veryfront.config.js", createBasicConfig());

      const result = await bootstrap(projectDir, adapter);

      assertEquals(result.adapter, adapter);
    } finally {
      await cleanupTempDir(projectDir);
    }
  });

  it("should load config with veryfront.config.ts", async () => {
    const adapter = denoAdapter;
    const projectDir = await createTempDir("ts_config");

    try {
      await writeConfigFile(
        projectDir,
        "veryfront.config.ts",
        `export default { title: 'TypeScript Config' };`,
      );

      const result = await bootstrap(projectDir, adapter);

      assertEquals(result.config.title, "TypeScript Config");
    } finally {
      await cleanupTempDir(projectDir);
    }
  });

  it("should load config with veryfront.config.mjs", async () => {
    const adapter = denoAdapter;
    const projectDir = await createTempDir("mjs_config");

    try {
      await writeConfigFile(
        projectDir,
        "veryfront.config.mjs",
        `export default { title: 'MJS Config' };`,
      );

      const result = await bootstrap(projectDir, adapter);

      assertEquals(result.config.title, "MJS Config");
    } finally {
      await cleanupTempDir(projectDir);
    }
  });

  it("should handle config with multiple nested properties", async () => {
    const adapter = denoAdapter;
    const projectDir = await createTempDir("nested_config");

    try {
      await writeConfigFile(
        projectDir,
        "veryfront.config.js",
        `export default {
          title: 'Nested Config',
          dev: { port: 4000, host: 'example.com' },
          build: { outDir: 'build', trailingSlash: true },
          theme: { colors: { primary: '#ff0000' } }
        };`,
      );

      const result = await bootstrap(projectDir, adapter);

      assertEquals(result.config.title, "Nested Config");
      assertEquals(result.config.dev?.port, 4000);
      assertEquals(result.config.dev?.host, "example.com");
      assertEquals(result.config.build?.outDir, "build");
      assertEquals(result.config.theme?.colors?.primary, "#ff0000");
    } finally {
      await cleanupTempDir(projectDir);
    }
  });

  it("should merge user config with defaults correctly", async () => {
    const adapter = denoAdapter;
    const projectDir = await createTempDir("merge_config");

    try {
      await writeConfigFile(
        projectDir,
        "veryfront.config.js",
        `export default { title: 'Merged', dev: { port: 5000 } };`,
      );

      const result = await bootstrap(projectDir, adapter);

      assertEquals(result.config.title, "Merged");
      assertEquals(result.config.dev?.port, 5000);
      assertEquals(result.config.dev?.host, "localhost");
      assertExists(result.config.build);
    } finally {
      await cleanupTempDir(projectDir);
    }
  });
});


describe("bootstrap - FSAdapter Initialization", () => {
  afterEach(() => {
    clearConfigCache();
  });

  it('should skip FSAdapter when type is "local"', async () => {
    const adapter = denoAdapter;
    const projectDir = await createTempDir("skip_fs");

    try {
      await writeConfigFile(
        projectDir,
        "veryfront.config.js",
        `export default { title: 'Skip FS', fs: { type: 'local' } };`,
      );

      const result = await bootstrap(projectDir, adapter);

      assertEquals(result.usingFSAdapter, false);
      assertEquals(result.adapter, adapter);
    } finally {
      await cleanupTempDir(projectDir);
    }
  });

  it("should skip FSAdapter when fs is undefined", async () => {
    const adapter = denoAdapter;
    const projectDir = await createTempDir("undefined_fs");

    try {
      await writeConfigFile(
        projectDir,
        "veryfront.config.js",
        `export default { title: 'No FS' };`,
      );

      const result = await bootstrap(projectDir, adapter);

      assertEquals(result.usingFSAdapter, false);
    } finally {
      await cleanupTempDir(projectDir);
    }
  });

  it("should skip FSAdapter when fs.type is undefined", async () => {
    const adapter = denoAdapter;
    const projectDir = await createTempDir("undefined_type");

    try {
      await writeConfigFile(
        projectDir,
        "veryfront.config.js",
        `export default {
          title: 'Undefined Type',
          fs: { veryfront: { projectSlug: 'test' } }
        };`,
      );

      const result = await bootstrap(projectDir, adapter);

      assertEquals(result.usingFSAdapter, false);
    } finally {
      await cleanupTempDir(projectDir);
    }
  });

  it("should handle fs config with missing credentials gracefully", async () => {
    const adapter = denoAdapter;
    const projectDir = await createTempDir("missing_creds");

    try {
      await writeConfigFile(
        projectDir,
        "veryfront.config.js",
        `export default {
          title: 'Missing Creds',
          fs: { type: 'veryfront-api' }
        };`,
      );

      const result = await bootstrap(projectDir, adapter);

      assertExists(result);
    } finally {
      await cleanupTempDir(projectDir);
    }
  });

  it("should handle FSAdapter initialization errors gracefully", async () => {
    const adapter = denoAdapter;
    const projectDir = await createTempDir("fs_error");

    try {
      await writeConfigFile(
        projectDir,
        "veryfront.config.js",
        createBasicConfig({ fsType: "memory" }),
      );

      const result = await bootstrap(projectDir, adapter);

      assertExists(result);
      assertExists(result.config);
      assertEquals(result.usingFSAdapter, false);
    } finally {
      await cleanupTempDir(projectDir);
    }
  });

  it("should reject unknown FSAdapter type in validation", async () => {
    const adapter = denoAdapter;
    const projectDir = await createTempDir("unknown_fs");

    try {
      await writeConfigFile(
        projectDir,
        "veryfront.config.js",
        `export default {
          title: 'Unknown FS',
          fs: { type: 'unknown-type' }
        };`,
      );

      await assertRejects(
        () => bootstrap(projectDir, adapter),
        Error,
        "Invalid veryfront.config",
      );
    } finally {
      await cleanupTempDir(projectDir);
    }
  });

  it("should preserve adapter platform property", async () => {
    const adapter = denoAdapter;
    const projectDir = await createTempDir("preserve_platform");

    try {
      await writeConfigFile(projectDir, "veryfront.config.js", createBasicConfig());

      const result = await bootstrap(projectDir, adapter);

      assertEquals(result.adapter.platform, "deno");
    } finally {
      await cleanupTempDir(projectDir);
    }
  });

  it("should preserve adapter features", async () => {
    const adapter = denoAdapter;
    const projectDir = await createTempDir("preserve_features");

    try {
      await writeConfigFile(projectDir, "veryfront.config.js", createBasicConfig());

      const result = await bootstrap(projectDir, adapter);

      assertExists(result.adapter.features);
      assertEquals(result.adapter.features.typescript, true);
    } finally {
      await cleanupTempDir(projectDir);
    }
  });
});


describe("bootstrap - Config Reloading", () => {
  afterEach(() => {
    clearConfigCache();
  });

  it("should reload config after cache clear", async () => {
    const adapter = denoAdapter;
    const projectDir = await createTempDir("reload_cache");

    try {
      await writeConfigFile(
        projectDir,
        "veryfront.config.js",
        `export default { title: 'Original' };`,
      );

      const result1 = await bootstrap(projectDir, adapter);
      assertEquals(result1.config.title, "Original");

      clearConfigCache();
      await new Promise((resolve) => setTimeout(resolve, 50));
      await writeConfigFile(
        projectDir,
        "veryfront.config.js",
        `export default { title: 'Updated' };`,
      );

      const result2 = await bootstrap(projectDir, adapter);
      assertEquals(result2.config.title, "Updated");
    } finally {
      await cleanupTempDir(projectDir);
    }
  });

  it("should use cached config on subsequent calls without clear", async () => {
    const adapter = denoAdapter;
    const projectDir = await createTempDir("cached_config");

    try {
      await writeConfigFile(
        projectDir,
        "veryfront.config.js",
        `export default { title: 'Cached' };`,
      );

      const result1 = await bootstrap(projectDir, adapter);

      await writeConfigFile(
        projectDir,
        "veryfront.config.js",
        `export default { title: 'Should Not See This' };`,
      );

      const result2 = await bootstrap(projectDir, adapter);

      assertEquals(result1.config.title, "Cached");
      assertEquals(result2.config.title, "Cached");
    } finally {
      await cleanupTempDir(projectDir);
    }
  });

  it("should clear cache before reloading", async () => {
    const adapter = denoAdapter;
    const projectDir = await createTempDir("clear_before_reload");

    try {
      await writeConfigFile(
        projectDir,
        "veryfront.config.js",
        `export default { title: 'Pre-Cache', dev: { port: 3000 } };`,
      );

      const result1 = await bootstrap(projectDir, adapter);
      assertEquals(result1.config.dev?.port, 3000);

      clearConfigCache();
      await new Promise((resolve) => setTimeout(resolve, 50));

      await writeConfigFile(
        projectDir,
        "veryfront.config.js",
        `export default { title: 'Post-Cache', dev: { port: 5000 } };`,
      );

      const result = await bootstrap(projectDir, adapter);
      assertEquals(result.config.title, "Post-Cache");
      assertEquals(result.config.dev?.port, 5000);
    } finally {
      await cleanupTempDir(projectDir);
    }
  });

  it("should handle config reload errors gracefully", async () => {
    const adapter = denoAdapter;
    const projectDir = await createTempDir("reload_error");

    try {
      await writeConfigFile(
        projectDir,
        "veryfront.config.js",
        `export default { title: 'Valid Config' };`,
      );

      const result = await bootstrap(projectDir, adapter);
      assertEquals(result.config.title, "Valid Config");

      clearConfigCache();

      await writeConfigFile(projectDir, "veryfront.config.js", `export default { invalid syntax`);

      try {
        await bootstrap(projectDir, adapter);
        assert(false, "Should have thrown error for invalid syntax");
      } catch (error) {
        assertExists(error);
      }
    } finally {
      await cleanupTempDir(projectDir);
    }
  });

  it("should maintain separate caches per project directory", async () => {
    const adapter = denoAdapter;
    const projectDir1 = await createTempDir("project_1");
    const projectDir2 = await createTempDir("project_2");

    try {
      await writeConfigFile(
        projectDir1,
        "veryfront.config.js",
        `export default { title: 'Project 1' };`,
      );
      await writeConfigFile(
        projectDir2,
        "veryfront.config.js",
        `export default { title: 'Project 2' };`,
      );

      const result1 = await bootstrap(projectDir1, adapter);
      const result2 = await bootstrap(projectDir2, adapter);

      assertEquals(result1.config.title, "Project 1");
      assertEquals(result2.config.title, "Project 2");
    } finally {
      await cleanupTempDir(projectDir1);
      await cleanupTempDir(projectDir2);
    }
  });

  it("should handle concurrent reload requests", async () => {
    const adapter = denoAdapter;
    const projectDir = await createTempDir("concurrent_reload");

    try {
      await writeConfigFile(
        projectDir,
        "veryfront.config.js",
        `export default { title: 'Concurrent' };`,
      );

      clearConfigCache();

      const [result1, result2, result3] = await Promise.all([
        bootstrap(projectDir, adapter),
        bootstrap(projectDir, adapter),
        bootstrap(projectDir, adapter),
      ]);

      assertEquals(result1.config.title, "Concurrent");
      assertEquals(result2.config.title, "Concurrent");
      assertEquals(result3.config.title, "Concurrent");
    } finally {
      await cleanupTempDir(projectDir);
    }
  });

  it("should preserve FSAdapter state across reloads", async () => {
    const adapter = denoAdapter;
    const projectDir = await createTempDir("preserve_state");

    try {
      await writeConfigFile(projectDir, "veryfront.config.js", createBasicConfig());

      const result1 = await bootstrap(projectDir, adapter);

      clearConfigCache();

      const result2 = await bootstrap(projectDir, adapter);

      assertEquals(result1.usingFSAdapter, false);
      assertEquals(result2.usingFSAdapter, false);
    } finally {
      await cleanupTempDir(projectDir);
    }
  });

  it("should reload config with different settings", async () => {
    const adapter = denoAdapter;
    const projectDir = await createTempDir("different_settings");

    try {
      await writeConfigFile(
        projectDir,
        "veryfront.config.js",
        `export default { title: 'First', description: 'First config', dev: { port: 3010 } };`,
      );

      const result1 = await bootstrap(projectDir, adapter);
      assertEquals(result1.config.description, "First config");

      clearConfigCache();
      await new Promise((resolve) => setTimeout(resolve, 10));

      await writeConfigFile(
        projectDir,
        "veryfront.config.js",
        `export default { title: 'Second', description: 'Second config', dev: { port: 4010 } };`,
      );

      const result2 = await bootstrap(projectDir, adapter);
      assertEquals(result2.config.description, "Second config");
    } finally {
      await cleanupTempDir(projectDir);
    }
  });

  it("should handle empty cache correctly", async () => {
    const adapter = denoAdapter;
    const projectDir = await createTempDir("empty_cache");

    try {
      clearConfigCache();
      await new Promise((resolve) => setTimeout(resolve, 50));

      await writeConfigFile(
        projectDir,
        "veryfront.config.js",
        `export default { title: 'Empty Cache' };`,
      );

      const result = await bootstrap(projectDir, adapter);
      assertEquals(result.config.title, "Empty Cache");
    } finally {
      await cleanupTempDir(projectDir);
    }
  });

  it("should support cache invalidation workflow", async () => {
    const adapter = denoAdapter;
    const projectDir = await createTempDir("invalidation");

    try {
      await writeConfigFile(
        projectDir,
        "veryfront.config.js",
        `export default { title: 'V1', description: 'Version 1' };`,
      );

      const result1 = await bootstrap(projectDir, adapter);
      assertEquals(result1.config.description, "Version 1");

      clearConfigCache();
      await new Promise((resolve) => setTimeout(resolve, 50));

      await writeConfigFile(
        projectDir,
        "veryfront.config.js",
        `export default { title: 'V2', description: 'Version 2' };`,
      );

      const result = await bootstrap(projectDir, adapter);
      assertEquals(result.config.description, "Version 2");
    } finally {
      await cleanupTempDir(projectDir);
    }
  });
});


describe("bootstrap - Error Handling", () => {
  afterEach(() => {
    clearConfigCache();
  });

  it("should handle missing config file gracefully", async () => {
    const adapter = denoAdapter;
    const projectDir = await createTempDir("missing_config");

    try {
      const result = await bootstrap(projectDir, adapter);

      assertExists(result);
      assertExists(result.config);
      assertEquals(result.config.title, "Veryfront App");
    } finally {
      await cleanupTempDir(projectDir);
    }
  });

  it("should handle invalid config syntax", async () => {
    const adapter = denoAdapter;
    const projectDir = await createTempDir("invalid_syntax");

    try {
      await writeConfigFile(
        projectDir,
        "veryfront.config.js",
        `export default { invalid syntax here`,
      );

      try {
        await bootstrap(projectDir, adapter);
        assert(false, "Should have thrown error for invalid syntax");
      } catch (error) {
        assertExists(error);
      }
    } finally {
      await cleanupTempDir(projectDir);
    }
  });

  it("should handle config with runtime errors", async () => {
    const adapter = denoAdapter;
    const projectDir = await createTempDir("runtime_error");

    try {
      await writeConfigFile(
        projectDir,
        "veryfront.config.js",
        `throw new Error('Runtime error'); export default {};`,
      );

      try {
        await bootstrap(projectDir, adapter);
        assert(false, "Should have thrown error for runtime error");
      } catch (error) {
        assertExists(error);
      }
    } finally {
      await cleanupTempDir(projectDir);
    }
  });

  it("should handle invalid CORS config in validation", async () => {
    const adapter = denoAdapter;
    const projectDir = await createTempDir("invalid_cors");

    try {
      await writeConfigFile(
        projectDir,
        "veryfront.config.js",
        `export default {
          title: 'Invalid CORS',
          security: {
            cors: { origin: 123 }
          }
        };`,
      );

      await assertRejects(
        () => bootstrap(projectDir, adapter),
        Error,
        "security.cors.origin",
      );
    } finally {
      await cleanupTempDir(projectDir);
    }
  });

  it("should reject invalid FSAdapter types", async () => {
    const adapter = denoAdapter;
    const projectDir = await createTempDir("fs_init_error");

    try {
      await writeConfigFile(
        projectDir,
        "veryfront.config.js",
        `export default {
          title: 'Invalid FS',
          fs: { type: 'not-a-valid-type' }
        };`,
      );

      await assertRejects(
        () => bootstrap(projectDir, adapter),
        Error,
        "Invalid veryfront.config",
      );
    } finally {
      await cleanupTempDir(projectDir);
    }
  });

  it("should reject config with null object values", async () => {
    const adapter = denoAdapter;
    const projectDir = await createTempDir("null_values");

    try {
      await writeConfigFile(
        projectDir,
        "veryfront.config.js",
        `export default {
          title: 'Null Values',
          theme: null
        };`,
      );

      await assertRejects(
        () => bootstrap(projectDir, adapter),
        Error,
        "Invalid veryfront.config",
      );
    } finally {
      await cleanupTempDir(projectDir);
    }
  });

  it("should handle config with undefined properties", async () => {
    const adapter = denoAdapter;
    const projectDir = await createTempDir("undefined_props");

    try {
      await writeConfigFile(
        projectDir,
        "veryfront.config.js",
        `export default {
          title: undefined,
          description: 'Has description'
        };`,
      );

      const result = await bootstrap(projectDir, adapter);

      assertExists(result);
      assertEquals(result.config.description, "Has description");
    } finally {
      await cleanupTempDir(projectDir);
    }
  });

  it("should handle config evaluation errors", async () => {
    const adapter = denoAdapter;
    const projectDir = await createTempDir("eval_error");

    try {
      await writeConfigFile(
        projectDir,
        "veryfront.config.js",
        `const x = undefined; x.property; export default {};`,
      );

      try {
        await bootstrap(projectDir, adapter);
        assert(false, "Should have thrown error for evaluation error");
      } catch (error) {
        assertExists(error);
      }
    } finally {
      await cleanupTempDir(projectDir);
    }
  });

  it("should handle circular config references", async () => {
    const adapter = denoAdapter;
    const projectDir = await createTempDir("circular_ref");

    try {
      await writeConfigFile(
        projectDir,
        "veryfront.config.js",
        `const config = { title: 'Circular' };
         config.self = config;
         export default config;`,
      );

      const result = await bootstrap(projectDir, adapter);

      assertExists(result);
      assertEquals(result.config.title, "Circular");
    } finally {
      await cleanupTempDir(projectDir);
    }
  });

  it("should handle config with functions", async () => {
    const adapter = denoAdapter;
    const projectDir = await createTempDir("functions");

    try {
      await writeConfigFile(
        projectDir,
        "veryfront.config.js",
        `export default {
          title: 'Functions',
          onBuild: () => console.log('build')
        };`,
      );

      const result = await bootstrap(projectDir, adapter);

      assertExists(result);
      assertEquals(result.config.title, "Functions");
    } finally {
      await cleanupTempDir(projectDir);
    }
  });
});


describe("bootstrap - Dev and Prod Modes", () => {
  afterEach(() => {
    clearConfigCache();
  });

  it("should initialize in development mode with bootstrapDev", async () => {
    const adapter = denoAdapter;
    const projectDir = await createTempDir("dev_mode");

    try {
      await writeConfigFile(projectDir, "veryfront.config.js", createBasicConfig());

      const result = await bootstrapDev(projectDir, adapter);

      assertExists(result);
      assertExists(result.config);
      assertEquals(result.config.title, "Test Bootstrap App");
    } finally {
      await cleanupTempDir(projectDir);
    }
  });

  it("should initialize in production mode with bootstrapProd", async () => {
    const adapter = denoAdapter;
    const projectDir = await createTempDir("prod_mode");

    try {
      await writeConfigFile(projectDir, "veryfront.config.js", createBasicConfig());

      const result = await bootstrapProd(projectDir, adapter);

      assertExists(result);
      assertExists(result.config);
      assertEquals(result.config.title, "Test Bootstrap App");
    } finally {
      await cleanupTempDir(projectDir);
    }
  });

  it("should handle errors in production mode", async () => {
    const adapter = denoAdapter;
    const projectDir = await createTempDir("prod_error");

    try {
      await writeConfigFile(
        projectDir,
        "veryfront.config.js",
        `export default { security: { cors: { origin: 123 } } };`,
      );

      await assertRejects(
        () => bootstrapProd(projectDir, adapter),
        Error,
      );
    } finally {
      await cleanupTempDir(projectDir);
    }
  });

  it("should log FSAdapter info in dev mode", async () => {
    const adapter = denoAdapter;
    const projectDir = await createTempDir("dev_fs_log");

    try {
      await writeConfigFile(projectDir, "veryfront.config.js", createBasicConfig());

      const result = await bootstrapDev(projectDir, adapter);

      assertExists(result);
      assertEquals(result.usingFSAdapter, false);
    } finally {
      await cleanupTempDir(projectDir);
    }
  });

  it("should handle defaults in both dev and prod", async () => {
    const adapter = denoAdapter;
    const projectDir = await createTempDir("default_modes");

    try {

      const devResult = await bootstrapDev(projectDir, adapter);
      clearConfigCache();
      const prodResult = await bootstrapProd(projectDir, adapter);

      assertExists(devResult);
      assertExists(prodResult);
      assertEquals(devResult.config.title, prodResult.config.title);
    } finally {
      await cleanupTempDir(projectDir);
    }
  });
});


describe("bootstrap - Edge Cases", () => {
  afterEach(() => {
    clearConfigCache();
  });

  it("should handle very long project directory paths", async () => {
    const adapter = denoAdapter;
    const baseDir = await createTempDir("long_path");
    const deepPath = join(baseDir, "very", "long", "path", "to", "project");

    try {
      await Deno.mkdir(deepPath, { recursive: true });
      await writeConfigFile(deepPath, "veryfront.config.js", createBasicConfig());

      const result = await bootstrap(deepPath, adapter);

      assertExists(result);
    } finally {
      await cleanupTempDir(baseDir);
    }
  });

  it("should handle config with very large objects", async () => {
    const adapter = denoAdapter;
    const projectDir = await createTempDir("large_config");

    try {
      const largeConfig: any = { title: "Large Config", theme: { colors: {} } };
      for (let i = 0; i < 100; i++) {
        largeConfig.theme.colors[`color${i}`] = `#${i.toString(16).padStart(6, "0")}`;
      }

      await writeConfigFile(
        projectDir,
        "veryfront.config.js",
        `export default ${JSON.stringify(largeConfig)};`,
      );

      const result = await bootstrap(projectDir, adapter);

      assertExists(result);
      assertEquals(result.config.title, "Large Config");
    } finally {
      await cleanupTempDir(projectDir);
    }
  });

  it("should handle concurrent bootstrap calls to same project", async () => {
    const adapter = denoAdapter;
    const projectDir = await createTempDir("concurrent_same");

    try {
      await writeConfigFile(projectDir, "veryfront.config.js", createBasicConfig());

      const [result1, result2, result3] = await Promise.all([
        bootstrap(projectDir, adapter),
        bootstrap(projectDir, adapter),
        bootstrap(projectDir, adapter),
      ]);

      assertEquals(result1.config.title, "Test Bootstrap App");
      assertEquals(result2.config.title, "Test Bootstrap App");
      assertEquals(result3.config.title, "Test Bootstrap App");
    } finally {
      await cleanupTempDir(projectDir);
    }
  });

  it("should handle concurrent bootstrap calls to different projects", async () => {
    const adapter = denoAdapter;
    const projectDir1 = await createTempDir("concurrent_1");
    const projectDir2 = await createTempDir("concurrent_2");
    const projectDir3 = await createTempDir("concurrent_3");

    try {
      await writeConfigFile(
        projectDir1,
        "veryfront.config.js",
        `export default { title: 'Project 1' };`,
      );
      await writeConfigFile(
        projectDir2,
        "veryfront.config.js",
        `export default { title: 'Project 2' };`,
      );
      await writeConfigFile(
        projectDir3,
        "veryfront.config.js",
        `export default { title: 'Project 3' };`,
      );

      const [result1, result2, result3] = await Promise.all([
        bootstrap(projectDir1, adapter),
        bootstrap(projectDir2, adapter),
        bootstrap(projectDir3, adapter),
      ]);

      assertEquals(result1.config.title, "Project 1");
      assertEquals(result2.config.title, "Project 2");
      assertEquals(result3.config.title, "Project 3");
    } finally {
      await cleanupTempDir(projectDir1);
      await cleanupTempDir(projectDir2);
      await cleanupTempDir(projectDir3);
    }
  });

  it("should handle config with all possible config keys", async () => {
    const adapter = denoAdapter;
    const projectDir = await createTempDir("all_keys");

    try {
      await writeConfigFile(
        projectDir,
        "veryfront.config.js",
        `export default {
          title: 'Complete Config',
          description: 'All keys',
          experimental: { esmLayouts: true },
          router: 'app',
          defaultLayout: './layout.tsx',
          theme: { colors: { primary: '#000' } },
          build: { outDir: 'dist', trailingSlash: false },
          cache: { dir: '.cache' },
          dev: { port: 3000, host: 'localhost' },
          resolve: { importMap: { imports: {} } },
          security: { cors: false },
          middleware: { custom: [] }
        };`,
      );

      const result = await bootstrap(projectDir, adapter);

      assertExists(result);
      assertEquals(result.config.title, "Complete Config");
      assertEquals(result.config.router, "app");
      assertEquals(result.config.experimental?.esmLayouts, true);
    } finally {
      await cleanupTempDir(projectDir);
    }
  });

  it("should handle empty config object", async () => {
    const adapter = denoAdapter;
    const projectDir = await createTempDir("empty_config");

    try {
      await writeConfigFile(projectDir, "veryfront.config.js", `export default {};`);

      const result = await bootstrap(projectDir, adapter);

      assertExists(result);
      assertExists(result.config);
      assertExists(result.config.title);
      assertExists(result.config.build);
    } finally {
      await cleanupTempDir(projectDir);
    }
  });

  it("should handle config priority (.js over .ts over .mjs)", async () => {
    const adapter = denoAdapter;
    const projectDir = await createTempDir("priority");

    try {
      await writeConfigFile(projectDir, "veryfront.config.js", `export default { title: 'JS' };`);
      await writeConfigFile(projectDir, "veryfront.config.ts", `export default { title: 'TS' };`);
      await writeConfigFile(projectDir, "veryfront.config.mjs", `export default { title: 'MJS' };`);

      const result = await bootstrap(projectDir, adapter);

      assertEquals(result.config.title, "JS");
    } finally {
      await cleanupTempDir(projectDir);
    }
  });

  it("should handle config with special characters in strings", async () => {
    const adapter = denoAdapter;
    const projectDir = await createTempDir("special_chars");

    try {
      await writeConfigFile(
        projectDir,
        "veryfront.config.js",
        `export default {
          title: 'Test \\n\\t\\r',
          description: 'With "quotes" and \\'escapes\\''
        };`,
      );

      const result = await bootstrap(projectDir, adapter);

      assertExists(result);
      assertExists(result.config.title);
    } finally {
      await cleanupTempDir(projectDir);
    }
  });

  it("should handle rapid sequential bootstraps", async () => {
    const adapter = denoAdapter;
    const projectDir = await createTempDir("rapid_sequential");

    try {
      await writeConfigFile(projectDir, "veryfront.config.js", createBasicConfig());

      const result1 = await bootstrap(projectDir, adapter);
      const result2 = await bootstrap(projectDir, adapter);
      const result3 = await bootstrap(projectDir, adapter);

      assertExists(result1);
      assertExists(result2);
      assertExists(result3);
    } finally {
      await cleanupTempDir(projectDir);
    }
  });

  it("should handle bootstrap after failed bootstrap", async () => {
    const adapter = denoAdapter;
    const projectDir1 = await createTempDir("failed_config");
    const projectDir2 = await createTempDir("success_config");

    try {
      await writeConfigFile(
        projectDir1,
        "veryfront.config.js",
        `export default { security: { cors: { origin: 123 } } };`,
      );

      try {
        await bootstrap(projectDir1, adapter);
      } catch {
        // Expected to fail
      }

      await writeConfigFile(projectDir2, "veryfront.config.js", createBasicConfig());

      const result = await bootstrap(projectDir2, adapter);

      assertExists(result);
      assertEquals(result.config.title, "Test Bootstrap App");
    } finally {
      await cleanupTempDir(projectDir1);
      await cleanupTempDir(projectDir2);
    }
  });
});

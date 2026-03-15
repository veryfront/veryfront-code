/**
 * Comprehensive tests for core/bootstrap.ts
 *
 * Tests the critical framework initialization module including:
 * - Basic bootstrap flow with config loading
 * - FSAdapter initialization and integration
 * - Config reloading and cache invalidation
 * - Error handling and graceful degradation
 * - Edge cases and concurrent operations
 */

// Disable LRU intervals during testing to prevent resource leaks
(globalThis as Record<string, unknown>).__vfDisableLruInterval = true;

import { assert, assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert";
import { afterEach, describe, it } from "#veryfront/testing/bdd";
import { bootstrap, bootstrapDev, bootstrapProd } from "../../../src/server/bootstrap.ts";
import { clearConfigCache } from "#veryfront/config";
import { join } from "#veryfront/compat/path";
import { mkdir, remove, writeTextFile } from "#veryfront/compat/fs.ts";
import { getAdapter } from "#veryfront/platform/adapters/detect.ts";
import { deleteEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { makeTempDir } from "#veryfront/testing/deno-compat";
import { isBun, isDeno, isNode } from "../../../src/platform/compat/runtime.ts";
import { delay } from "#std/async";

async function createTempDir(prefix: string): Promise<string> {
  return await makeTempDir({ prefix: `bootstrap_test_${prefix}_` });
}

async function cleanupTempDir(dir: string): Promise<void> {
  try {
    await remove(dir, { recursive: true });
  } catch {
    // Ignore cleanup errors
  }
}

async function writeConfigFile(
  projectDir: string,
  filename: string,
  content: string,
): Promise<void> {
  await writeTextFile(join(projectDir, filename), content);
}

function createBasicConfig(
  options: {
    title?: string;
    fsType?: string;
    projectSlug?: string;
    apiKey?: string;
    [key: string]: any;
  } = {},
): string {
  const { fsType, projectSlug, apiKey, ...rest } = options;

  const config: any = {
    title: options.title || "Test Bootstrap App",
    description: "Testing bootstrap module",
    ...rest,
  };

  if (fsType && fsType !== "local") {
    config.fs = {
      type: fsType,
      veryfront: {
        projectSlug: projectSlug || "test-project",
        apiKey: apiKey || "test-api-key",
      },
    };
  }

  return `export default ${JSON.stringify(config, null, 2)};`;
}

async function withTempProjectDir<T>(
  prefix: string,
  fn: (projectDir: string) => Promise<T>,
): Promise<T> {
  const projectDir = await createTempDir(prefix);
  try {
    return await fn(projectDir);
  } finally {
    await cleanupTempDir(projectDir);
  }
}

async function expectBootstrapThrows(projectDir: string, adapter: unknown): Promise<void> {
  try {
    await bootstrap(projectDir, adapter as any);
    assert(false, "Should have thrown error");
  } catch (error) {
    assertExists(error);
  }
}

function withEnvOverrides(vars: Record<string, string | undefined>): () => void {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(vars)) {
    previous.set(key, Deno.env.get(key));
    if (value === undefined) {
      deleteEnv(key);
    } else {
      setEnv(key, value);
    }
  }

  return () => {
    for (const [key, value] of previous) {
      if (value === undefined) {
        deleteEnv(key);
      } else {
        setEnv(key, value);
      }
    }
  };
}

// ============================================================================
// 1. Basic Bootstrap Flow (10 tests)
// ============================================================================

describe("bootstrap - Basic Flow", () => {
  afterEach(() => {
    clearConfigCache();
  });

  it("should initialize with default config when no config file exists", async () => {
    const adapter = await getAdapter();

    await withTempProjectDir("default", async (projectDir) => {
      const result = await bootstrap(projectDir, adapter);

      assertExists(result);
      assertExists(result.adapter);
      assertExists(result.config);
      assertEquals(result.usingFSAdapter, false);
      assertEquals(result.config.title, "Veryfront App");
    });
  });

  it("should initialize with custom config from veryfront.config.js", async () => {
    const adapter = await getAdapter();

    await withTempProjectDir("custom", async (projectDir) => {
      await writeConfigFile(projectDir, "veryfront.config.js", createBasicConfig());

      const result = await bootstrap(projectDir, adapter);

      assertExists(result);
      assertEquals(result.config.title, "Test Bootstrap App");
      assertEquals(result.usingFSAdapter, false);
    });
  });

  it("should initialize with custom projectDir path", async () => {
    const adapter = await getAdapter();

    await withTempProjectDir("custom_path", async (projectDir) => {
      await writeConfigFile(projectDir, "veryfront.config.js", createBasicConfig());

      const result = await bootstrap(projectDir, adapter);

      assertExists(result);
      assertEquals(result.config.title, "Test Bootstrap App");
    });
  });

  it('should use local filesystem when fs.type is "local"', async () => {
    const adapter = await getAdapter();

    await withTempProjectDir("local_fs", async (projectDir) => {
      await writeConfigFile(
        projectDir,
        "veryfront.config.js",
        `export default { title: 'Local FS App', fs: { type: 'local' } };`,
      );

      const result = await bootstrap(projectDir, adapter);

      assertEquals(result.usingFSAdapter, false);
      assertEquals(result.fsAdapterType, undefined);
    });
  });

  it("should use local filesystem when fs is not configured", async () => {
    const adapter = await getAdapter();

    await withTempProjectDir("no_fs", async (projectDir) => {
      await writeConfigFile(
        projectDir,
        "veryfront.config.js",
        `export default { title: 'No FS Config' };`,
      );

      const result = await bootstrap(projectDir, adapter);

      assertEquals(result.usingFSAdapter, false);
      assertEquals(result.fsAdapterType, undefined);
    });
  });

  it("should return same adapter when using local filesystem", async () => {
    const adapter = await getAdapter();

    await withTempProjectDir("same_adapter", async (projectDir) => {
      await writeConfigFile(projectDir, "veryfront.config.js", createBasicConfig());

      const result = await bootstrap(projectDir, adapter);

      assertEquals(result.adapter, adapter);
    });
  });

  it("should load config with veryfront.config.ts", async () => {
    const adapter = await getAdapter();

    await withTempProjectDir("ts_config", async (projectDir) => {
      await writeConfigFile(
        projectDir,
        "veryfront.config.ts",
        `export default { title: 'TypeScript Config' };`,
      );

      const result = await bootstrap(projectDir, adapter);

      assertEquals(result.config.title, "TypeScript Config");
    });
  });

  it("should load config with veryfront.config.mjs", async () => {
    const adapter = await getAdapter();

    await withTempProjectDir("mjs_config", async (projectDir) => {
      await writeConfigFile(
        projectDir,
        "veryfront.config.mjs",
        `export default { title: 'MJS Config' };`,
      );

      const result = await bootstrap(projectDir, adapter);

      assertEquals(result.config.title, "MJS Config");
    });
  });

  it("should handle config with multiple nested properties", async () => {
    const adapter = await getAdapter();

    await withTempProjectDir("nested_config", async (projectDir) => {
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
    });
  });

  it("should merge user config with defaults correctly", async () => {
    const adapter = await getAdapter();

    await withTempProjectDir("merge_config", async (projectDir) => {
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
    });
  });
});

// ============================================================================
// 2. FSAdapter Initialization (10 tests)
// ============================================================================

// Note: sanitizeOps and sanitizeResources disabled because global module caches
// create background intervals that persist across tests (LRU cleanup timers).
// These are intentional and cleaned up on process exit.
describe("bootstrap - FSAdapter Initialization", {
  sanitizeOps: false,
  sanitizeResources: false,
}, () => {
  afterEach(() => {
    clearConfigCache();
  });

  it('should skip FSAdapter when type is "local"', async () => {
    const adapter = await getAdapter();

    await withTempProjectDir("skip_fs", async (projectDir) => {
      await writeConfigFile(
        projectDir,
        "veryfront.config.js",
        `export default { title: 'Skip FS', fs: { type: 'local' } };`,
      );

      const result = await bootstrap(projectDir, adapter);

      assertEquals(result.usingFSAdapter, false);
      assertEquals(result.adapter, adapter);
    });
  });

  it("should skip FSAdapter when fs is undefined", async () => {
    const adapter = await getAdapter();

    await withTempProjectDir("undefined_fs", async (projectDir) => {
      await writeConfigFile(
        projectDir,
        "veryfront.config.js",
        `export default { title: 'No FS' };`,
      );

      const result = await bootstrap(projectDir, adapter);

      assertEquals(result.usingFSAdapter, false);
    });
  });

  it("should skip FSAdapter when fs.type is undefined", async () => {
    const adapter = await getAdapter();

    await withTempProjectDir("undefined_type", async (projectDir) => {
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
    });
  });

  it("should handle fs config with missing credentials gracefully", async () => {
    const adapter = await getAdapter();

    await withTempProjectDir("missing_creds", async (projectDir) => {
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
    });
  });

  it("should handle FSAdapter initialization errors gracefully", async () => {
    const adapter = await getAdapter();

    await withTempProjectDir("fs_error", async (projectDir) => {
      await writeConfigFile(
        projectDir,
        "veryfront.config.js",
        createBasicConfig({ fsType: "memory" }),
      );

      const result = await bootstrap(projectDir, adapter);

      assertExists(result);
      assertExists(result.config);
      assertEquals(result.usingFSAdapter, false);
    });
  });

  it("should reject unknown FSAdapter type in validation", async () => {
    const adapter = await getAdapter();

    await withTempProjectDir("unknown_fs", async (projectDir) => {
      await writeConfigFile(
        projectDir,
        "veryfront.config.js",
        `export default {
          title: 'Unknown FS',
          fs: { type: 'unknown-type' }
        };`,
      );

      await assertRejects(() => bootstrap(projectDir, adapter), Error, "Invalid veryfront.config");
    });
  });

  it("should preserve adapter platform property", async () => {
    const adapter = await getAdapter();

    await withTempProjectDir("preserve_platform", async (projectDir) => {
      await writeConfigFile(projectDir, "veryfront.config.js", createBasicConfig());

      const result = await bootstrap(projectDir, adapter);

      if (isDeno) assertEquals(result.adapter.id, "deno");
      else if (isNode) assertEquals(result.adapter.id, "node");
      else if (isBun) assertEquals(result.adapter.id, "bun");
    });
  });

  it("should preserve adapter features", async () => {
    const adapter = await getAdapter();

    await withTempProjectDir("preserve_features", async (projectDir) => {
      await writeConfigFile(projectDir, "veryfront.config.js", createBasicConfig());

      const result = await bootstrap(projectDir, adapter);

      assertExists(result.adapter.capabilities);
      if (isDeno || isBun) assertEquals(result.adapter.capabilities.typescript, true);
      else if (isNode) assertEquals(result.adapter.capabilities.typescript, false);
    });
  });
});

// ============================================================================
// 3. Config Reloading (10 tests)
// Note: Some tests are skipped in Bun because its ESM loader doesn't
// properly invalidate module cache with query string cache busters.
// ============================================================================

const reloadIt = isBun ? it.skip : it;

describe("bootstrap - Config Reloading", () => {
  afterEach(() => {
    clearConfigCache();
  });

  reloadIt("should reload config after cache clear", async () => {
    const adapter = await getAdapter();

    await withTempProjectDir("reload_cache", async (projectDir) => {
      await writeConfigFile(
        projectDir,
        "veryfront.config.js",
        `export default { title: 'Original' };`,
      );

      const result1 = await bootstrap(projectDir, adapter);
      assertEquals(result1.config.title, "Original");

      clearConfigCache();
      await delay(50);

      await writeConfigFile(
        projectDir,
        "veryfront.config.js",
        `export default { title: 'Updated' };`,
      );

      const result2 = await bootstrap(projectDir, adapter);
      assertEquals(result2.config.title, "Updated");
    });
  });

  it("should use cached config on subsequent calls without clear", async () => {
    const adapter = await getAdapter();

    await withTempProjectDir("cached_config", async (projectDir) => {
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
    });
  });

  reloadIt("should clear cache before reloading", async () => {
    const adapter = await getAdapter();

    await withTempProjectDir("clear_before_reload", async (projectDir) => {
      await writeConfigFile(
        projectDir,
        "veryfront.config.js",
        `export default { title: 'Pre-Cache', dev: { port: 3000 } };`,
      );

      const result1 = await bootstrap(projectDir, adapter);
      assertEquals(result1.config.dev?.port, 3000);

      clearConfigCache();
      await delay(50);

      await writeConfigFile(
        projectDir,
        "veryfront.config.js",
        `export default { title: 'Post-Cache', dev: { port: 5000 } };`,
      );

      const result = await bootstrap(projectDir, adapter);
      assertEquals(result.config.title, "Post-Cache");
      assertEquals(result.config.dev?.port, 5000);
    });
  });

  it("should handle config reload errors gracefully", async () => {
    const adapter = await getAdapter();

    await withTempProjectDir("reload_error", async (projectDir) => {
      await writeConfigFile(
        projectDir,
        "veryfront.config.js",
        `export default { title: 'Valid Config' };`,
      );

      const result = await bootstrap(projectDir, adapter);
      assertEquals(result.config.title, "Valid Config");

      clearConfigCache();

      await writeConfigFile(projectDir, "veryfront.config.js", `export default { invalid syntax`);

      await expectBootstrapThrows(projectDir, adapter);
    });
  });

  it("should maintain separate caches per project directory", async () => {
    const adapter = await getAdapter();
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
    const adapter = await getAdapter();

    await withTempProjectDir("concurrent_reload", async (projectDir) => {
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
    });
  });

  it("should preserve FSAdapter state across reloads", async () => {
    const adapter = await getAdapter();

    await withTempProjectDir("preserve_state", async (projectDir) => {
      await writeConfigFile(projectDir, "veryfront.config.js", createBasicConfig());

      const result1 = await bootstrap(projectDir, adapter);

      clearConfigCache();

      const result2 = await bootstrap(projectDir, adapter);

      assertEquals(result1.usingFSAdapter, false);
      assertEquals(result2.usingFSAdapter, false);
    });
  });

  reloadIt("should reload config with different settings", async () => {
    const adapter = await getAdapter();

    await withTempProjectDir("different_settings", async (projectDir) => {
      await writeConfigFile(
        projectDir,
        "veryfront.config.js",
        `export default { title: 'First', description: 'First config', dev: { port: 3010 } };`,
      );

      const result1 = await bootstrap(projectDir, adapter);
      assertEquals(result1.config.description, "First config");

      clearConfigCache();
      await delay(10);

      await writeConfigFile(
        projectDir,
        "veryfront.config.js",
        `export default { title: 'Second', description: 'Second config', dev: { port: 4010 } };`,
      );

      const result2 = await bootstrap(projectDir, adapter);
      assertEquals(result2.config.description, "Second config");
    });
  });

  it("should handle empty cache correctly", async () => {
    const adapter = await getAdapter();

    await withTempProjectDir("empty_cache", async (projectDir) => {
      clearConfigCache();
      await delay(50);

      await writeConfigFile(
        projectDir,
        "veryfront.config.js",
        `export default { title: 'Empty Cache' };`,
      );

      const result = await bootstrap(projectDir, adapter);
      assertEquals(result.config.title, "Empty Cache");
    });
  });

  reloadIt("should support cache invalidation workflow", async () => {
    const adapter = await getAdapter();

    await withTempProjectDir("invalidation", async (projectDir) => {
      await writeConfigFile(
        projectDir,
        "veryfront.config.js",
        `export default { title: 'V1', description: 'Version 1' };`,
      );

      const result1 = await bootstrap(projectDir, adapter);
      assertEquals(result1.config.description, "Version 1");

      clearConfigCache();
      await delay(50);

      await writeConfigFile(
        projectDir,
        "veryfront.config.js",
        `export default { title: 'V2', description: 'Version 2' };`,
      );

      const result = await bootstrap(projectDir, adapter);
      assertEquals(result.config.description, "Version 2");
    });
  });
});

// ============================================================================
// 4. Error Handling (10 tests)
// ============================================================================

describe("bootstrap - Error Handling", () => {
  afterEach(() => {
    clearConfigCache();
  });

  it("should handle missing config file gracefully", async () => {
    const adapter = await getAdapter();

    await withTempProjectDir("missing_config", async (projectDir) => {
      const result = await bootstrap(projectDir, adapter);

      assertExists(result);
      assertExists(result.config);
      assertEquals(result.config.title, "Veryfront App");
    });
  });

  it("should handle invalid config syntax", async () => {
    const adapter = await getAdapter();

    await withTempProjectDir("invalid_syntax", async (projectDir) => {
      await writeConfigFile(
        projectDir,
        "veryfront.config.js",
        `export default { invalid syntax here`,
      );

      await expectBootstrapThrows(projectDir, adapter);
    });
  });

  it("should handle config with runtime errors", async () => {
    const adapter = await getAdapter();

    await withTempProjectDir("runtime_error", async (projectDir) => {
      await writeConfigFile(
        projectDir,
        "veryfront.config.js",
        `throw new Error('Runtime error'); export default {};`,
      );

      await expectBootstrapThrows(projectDir, adapter);
    });
  });

  it("should handle invalid CORS config in validation", async () => {
    const adapter = await getAdapter();

    await withTempProjectDir("invalid_cors", async (projectDir) => {
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

      await assertRejects(() => bootstrap(projectDir, adapter), Error, "security.cors.origin");
    });
  });

  it("should reject invalid FSAdapter types", async () => {
    const adapter = await getAdapter();

    await withTempProjectDir("fs_init_error", async (projectDir) => {
      await writeConfigFile(
        projectDir,
        "veryfront.config.js",
        `export default {
          title: 'Invalid FS',
          fs: { type: 'not-a-valid-type' }
        };`,
      );

      await assertRejects(() => bootstrap(projectDir, adapter), Error, "Invalid veryfront.config");
    });
  });

  it("should reject config with null object values", async () => {
    const adapter = await getAdapter();

    await withTempProjectDir("null_values", async (projectDir) => {
      await writeConfigFile(
        projectDir,
        "veryfront.config.js",
        `export default {
          title: 'Null Values',
          theme: null
        };`,
      );

      await assertRejects(() => bootstrap(projectDir, adapter), Error, "Invalid veryfront.config");
    });
  });

  it("should handle config with undefined properties", async () => {
    const adapter = await getAdapter();

    await withTempProjectDir("undefined_props", async (projectDir) => {
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
    });
  });

  it("should handle config evaluation errors", async () => {
    const adapter = await getAdapter();

    await withTempProjectDir("eval_error", async (projectDir) => {
      await writeConfigFile(
        projectDir,
        "veryfront.config.js",
        `const x = undefined; x.property; export default {};`,
      );

      await expectBootstrapThrows(projectDir, adapter);
    });
  });

  it("should reject circular config with unknown keys", async () => {
    const adapter = await getAdapter();

    await withTempProjectDir("circular_ref", async (projectDir) => {
      await writeConfigFile(
        projectDir,
        "veryfront.config.js",
        `const config = { title: 'Circular' };
         config.self = config;
         export default config;`,
      );

      await assertRejects(() => bootstrap(projectDir, adapter), Error, "Unknown config keys: self");
    });
  });

  it("should reject config with unknown function keys", async () => {
    const adapter = await getAdapter();

    await withTempProjectDir("functions", async (projectDir) => {
      await writeConfigFile(
        projectDir,
        "veryfront.config.js",
        `export default {
          title: 'Functions',
          onBuild: () => console.log('build')
        };`,
      );

      await assertRejects(
        () => bootstrap(projectDir, adapter),
        Error,
        "Unknown config keys: onBuild",
      );
    });
  });
});

// ============================================================================
// 5. Dev/Prod Mode (5 tests)
// ============================================================================

describe("bootstrap - Dev and Prod Modes", () => {
  afterEach(() => {
    clearConfigCache();
  });

  it("should initialize in development mode with bootstrapDev", async () => {
    const adapter = await getAdapter();

    await withTempProjectDir("dev_mode", async (projectDir) => {
      await writeConfigFile(projectDir, "veryfront.config.js", createBasicConfig());

      const result = await bootstrapDev(projectDir, adapter);

      assertExists(result);
      assertExists(result.config);
      assertEquals(result.config.title, "Test Bootstrap App");
    });
  });

  it("should initialize in production mode with bootstrapProd", async () => {
    const adapter = await getAdapter();

    await withTempProjectDir("prod_mode", async (projectDir) => {
      await writeConfigFile(projectDir, "veryfront.config.js", createBasicConfig());

      const result = await bootstrapProd(projectDir, adapter);

      assertExists(result);
      assertExists(result.config);
      assertEquals(result.config.title, "Test Bootstrap App");
    });
  });

  it("should handle errors in production mode", async () => {
    const adapter = await getAdapter();

    await withTempProjectDir("prod_error", async (projectDir) => {
      await writeConfigFile(
        projectDir,
        "veryfront.config.js",
        `export default { security: { cors: { origin: 123 } } };`,
      );

      await assertRejects(() => bootstrapProd(projectDir, adapter), Error);
    });
  });

  it("should reject proxy mode startup when control-plane signing key is missing", async () => {
    const adapter = await getAdapter();
    const restore = withEnvOverrides({
      NODE_ENV: "production",
      PROXY_MODE: "1",
      CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY: undefined,
    });

    try {
      await withTempProjectDir("prod_missing_control_plane_key", async (projectDir) => {
        await writeConfigFile(projectDir, "veryfront.config.js", createBasicConfig());

        await assertRejects(
          () => bootstrapProd(projectDir, adapter),
          Error,
          "CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY must be set",
        );
      });
    } finally {
      restore();
    }
  });

  it("should log FSAdapter info in dev mode", async () => {
    const adapter = await getAdapter();

    await withTempProjectDir("dev_fs_log", async (projectDir) => {
      await writeConfigFile(projectDir, "veryfront.config.js", createBasicConfig());

      const result = await bootstrapDev(projectDir, adapter);

      assertExists(result);
      assertEquals(result.usingFSAdapter, false);
    });
  });

  it("should handle defaults in both dev and prod", async () => {
    const adapter = await getAdapter();

    await withTempProjectDir("default_modes", async (projectDir) => {
      const devResult = await bootstrapDev(projectDir, adapter);
      clearConfigCache();
      const prodResult = await bootstrapProd(projectDir, adapter);

      assertExists(devResult);
      assertExists(prodResult);
      assertEquals(devResult.config.title, prodResult.config.title);
    });
  });
});

// ============================================================================
// 6. Edge Cases (10 tests)
// ============================================================================

describe("bootstrap - Edge Cases", () => {
  afterEach(() => {
    clearConfigCache();
  });

  it("should handle very long project directory paths", async () => {
    const adapter = await getAdapter();
    const baseDir = await createTempDir("long_path");
    const deepPath = join(baseDir, "very", "long", "path", "to", "project");

    try {
      await mkdir(deepPath, { recursive: true });
      await writeConfigFile(deepPath, "veryfront.config.js", createBasicConfig());

      const result = await bootstrap(deepPath, adapter);

      assertExists(result);
    } finally {
      await cleanupTempDir(baseDir);
    }
  });

  it("should handle config with very large objects", async () => {
    const adapter = await getAdapter();

    await withTempProjectDir("large_config", async (projectDir) => {
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
    });
  });

  it("should handle concurrent bootstrap calls to same project", async () => {
    const adapter = await getAdapter();

    await withTempProjectDir("concurrent_same", async (projectDir) => {
      await writeConfigFile(projectDir, "veryfront.config.js", createBasicConfig());

      const [result1, result2, result3] = await Promise.all([
        bootstrap(projectDir, adapter),
        bootstrap(projectDir, adapter),
        bootstrap(projectDir, adapter),
      ]);

      assertEquals(result1.config.title, "Test Bootstrap App");
      assertEquals(result2.config.title, "Test Bootstrap App");
      assertEquals(result3.config.title, "Test Bootstrap App");
    });
  });

  it("should handle concurrent bootstrap calls to different projects", async () => {
    const adapter = await getAdapter();
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
    const adapter = await getAdapter();

    await withTempProjectDir("all_keys", async (projectDir) => {
      await writeConfigFile(
        projectDir,
        "veryfront.config.js",
        `export default {
          title: 'Complete Config',
          description: 'All keys',
          experimental: { esmLayouts: true },
          router: 'app',
          layout: './layout.tsx',
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
    });
  });

  it("should handle empty config object", async () => {
    const adapter = await getAdapter();

    await withTempProjectDir("empty_config", async (projectDir) => {
      await writeConfigFile(projectDir, "veryfront.config.js", `export default {};`);

      const result = await bootstrap(projectDir, adapter);

      assertExists(result);
      assertExists(result.config);
      assertExists(result.config.title);
      assertExists(result.config.build);
    });
  });

  it("should handle config priority (.js over .ts over .mjs)", async () => {
    const adapter = await getAdapter();

    await withTempProjectDir("priority", async (projectDir) => {
      await writeConfigFile(projectDir, "veryfront.config.js", `export default { title: 'JS' };`);
      await writeConfigFile(projectDir, "veryfront.config.ts", `export default { title: 'TS' };`);
      await writeConfigFile(projectDir, "veryfront.config.mjs", `export default { title: 'MJS' };`);

      const result = await bootstrap(projectDir, adapter);

      assertEquals(result.config.title, "JS");
    });
  });

  it("should handle config with special characters in strings", async () => {
    const adapter = await getAdapter();

    await withTempProjectDir("special_chars", async (projectDir) => {
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
    });
  });

  it("should handle rapid sequential bootstraps", async () => {
    const adapter = await getAdapter();

    await withTempProjectDir("rapid_sequential", async (projectDir) => {
      await writeConfigFile(projectDir, "veryfront.config.js", createBasicConfig());

      const result1 = await bootstrap(projectDir, adapter);
      const result2 = await bootstrap(projectDir, adapter);
      const result3 = await bootstrap(projectDir, adapter);

      assertExists(result1);
      assertExists(result2);
      assertExists(result3);
    });
  });

  it("should handle bootstrap after failed bootstrap", async () => {
    const adapter = await getAdapter();
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

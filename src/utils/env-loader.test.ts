import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { loadEnv, supportsEnvFiles } from "./env-loader.ts";

describe("env-loader", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await Deno.makeTempDir({ prefix: "env-loader-test-" });
  });

  afterEach(async () => {
    await Deno.remove(tempDir, { recursive: true });
  });

  describe("supportsEnvFiles", () => {
    it("should return true in Deno environment", () => {
      const result = supportsEnvFiles();
      assertEquals(result, true);
    });
  });

  describe("loadEnv", () => {
    it("should load variables from .env file", async () => {
      const key = `TEST_ENV_LOADER_${Date.now()}_BASIC`;
      await Deno.writeTextFile(`${tempDir}/.env`, `${key}=hello`);

      await loadEnv({ cwd: tempDir, override: true });
      assertEquals(Deno.env.get(key), "hello");

      // Cleanup
      Deno.env.delete(key);
    });

    it("should skip comments and blank lines", async () => {
      const key = `TEST_ENV_LOADER_${Date.now()}_COMMENTS`;
      await Deno.writeTextFile(
        `${tempDir}/.env`,
        `# This is a comment\n\n// Also a comment\n${key}=value\n`,
      );

      await loadEnv({ cwd: tempDir, override: true });
      assertEquals(Deno.env.get(key), "value");

      Deno.env.delete(key);
    });

    it("should handle quoted values with double quotes", async () => {
      const key = `TEST_ENV_LOADER_${Date.now()}_DQ`;
      await Deno.writeTextFile(`${tempDir}/.env`, `${key}="hello world"`);

      await loadEnv({ cwd: tempDir, override: true });
      assertEquals(Deno.env.get(key), "hello world");

      Deno.env.delete(key);
    });

    it("should handle quoted values with single quotes", async () => {
      const key = `TEST_ENV_LOADER_${Date.now()}_SQ`;
      await Deno.writeTextFile(`${tempDir}/.env`, `${key}='hello world'`);

      await loadEnv({ cwd: tempDir, override: true });
      assertEquals(Deno.env.get(key), "hello world");

      Deno.env.delete(key);
    });

    it("should strip inline comments from unquoted values", async () => {
      const key = `TEST_ENV_LOADER_${Date.now()}_INLINE`;
      await Deno.writeTextFile(`${tempDir}/.env`, `${key}=value # comment`);

      await loadEnv({ cwd: tempDir, override: true });
      assertEquals(Deno.env.get(key), "value");

      Deno.env.delete(key);
    });

    it("should expand variables with ${VAR} syntax", async () => {
      const key1 = `TEST_ENV_LOADER_${Date.now()}_BASE`;
      const key2 = `TEST_ENV_LOADER_${Date.now()}_EXPANDED`;
      await Deno.writeTextFile(
        `${tempDir}/.env`,
        `${key1}=hello\n${key2}=\${${key1}}_world`,
      );

      await loadEnv({ cwd: tempDir, override: true });
      assertEquals(Deno.env.get(key2), "hello_world");

      Deno.env.delete(key1);
      Deno.env.delete(key2);
    });

    it("should not override existing env vars by default", async () => {
      const key = `TEST_ENV_LOADER_${Date.now()}_NOOVERRIDE`;
      Deno.env.set(key, "existing");
      await Deno.writeTextFile(`${tempDir}/.env`, `${key}=new`);

      await loadEnv({ cwd: tempDir });
      assertEquals(Deno.env.get(key), "existing");

      Deno.env.delete(key);
    });

    it("should override existing env vars when override is true", async () => {
      const key = `TEST_ENV_LOADER_${Date.now()}_OVERRIDE`;
      Deno.env.set(key, "existing");
      await Deno.writeTextFile(`${tempDir}/.env`, `${key}=new`);

      await loadEnv({ cwd: tempDir, override: true });
      assertEquals(Deno.env.get(key), "new");

      Deno.env.delete(key);
    });

    it("should handle multiline values in double quotes", async () => {
      const key = `TEST_ENV_LOADER_${Date.now()}_MULTI`;
      await Deno.writeTextFile(
        `${tempDir}/.env`,
        `${key}="line1\nline2"`,
      );

      await loadEnv({ cwd: tempDir, override: true });
      assertEquals(Deno.env.get(key), "line1\nline2");

      Deno.env.delete(key);
    });

    it("should load .env.local with higher priority", async () => {
      const key = `TEST_ENV_LOADER_${Date.now()}_LOCAL`;
      await Deno.writeTextFile(`${tempDir}/.env`, `${key}=from_env`);
      await Deno.writeTextFile(`${tempDir}/.env.local`, `${key}=from_local`);

      await loadEnv({ cwd: tempDir, override: true });
      assertEquals(Deno.env.get(key), "from_local");

      Deno.env.delete(key);
    });

    it("should handle lines without equals sign", async () => {
      const key = `TEST_ENV_LOADER_${Date.now()}_NOEQ`;
      await Deno.writeTextFile(
        `${tempDir}/.env`,
        `noequalssign\n${key}=valid`,
      );

      await loadEnv({ cwd: tempDir, override: true });
      assertEquals(Deno.env.get(key), "valid");

      Deno.env.delete(key);
    });

    it("should not throw when no env files exist", async () => {
      // tempDir has no .env files - should not throw
      await loadEnv({ cwd: tempDir });
    });

    it("should handle empty values", async () => {
      const key = `TEST_ENV_LOADER_${Date.now()}_EMPTY`;
      await Deno.writeTextFile(`${tempDir}/.env`, `${key}=`);

      await loadEnv({ cwd: tempDir, override: true });
      assertEquals(Deno.env.get(key), "");

      Deno.env.delete(key);
    });

    it("should handle values with equals signs", async () => {
      const key = `TEST_ENV_LOADER_${Date.now()}_EQ`;
      await Deno.writeTextFile(`${tempDir}/.env`, `${key}=a=b=c`);

      await loadEnv({ cwd: tempDir, override: true });
      assertEquals(Deno.env.get(key), "a=b=c");

      Deno.env.delete(key);
    });

    it("should trim key names", async () => {
      const key = `TEST_ENV_LOADER_${Date.now()}_TRIM`;
      await Deno.writeTextFile(`${tempDir}/.env`, `  ${key}  =value`);

      await loadEnv({ cwd: tempDir, override: true });
      assertEquals(Deno.env.get(key), "value");

      Deno.env.delete(key);
    });
  });
});

import { assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

describe("compat/index.ts exports", () => {
  it("should export fs functions", async () => {
    const { createFileSystem } = await import("./index.ts");
    assertExists(createFileSystem);
  });

  it("should export kv functions", async () => {
    const { createKVStore, MemoryKv } = await import("./index.ts");
    assertExists(createKVStore);
    assertExists(MemoryKv);
  });

  it("should export process functions", async () => {
    const { cwd, env, getArgs, getEnv, pid, setEnv } = await import("./index.ts");
    assertExists(cwd);
    assertExists(env);
    assertExists(getArgs);
    assertExists(getEnv);
    assertExists(pid);
    assertExists(setEnv);
  });

  it("should export runtime detection constants", async () => {
    const { isBun, isDeno, isNode, isCloudflare } = await import("./index.ts");
    assertExists(typeof isDeno === "boolean");
    assertExists(typeof isNode === "boolean");
    assertExists(typeof isBun === "boolean");
    assertExists(typeof isCloudflare === "boolean");
  });
});

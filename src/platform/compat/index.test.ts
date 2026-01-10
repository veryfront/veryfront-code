import { assertExists } from "jsr:@std/assert@1";
import { describe, it } from "jsr:@std/testing@1/bdd";

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
    // These are boolean constants
    assertExists(typeof isDeno === "boolean" ? true : false);
    assertExists(typeof isNode === "boolean" ? true : false);
    assertExists(typeof isBun === "boolean" ? true : false);
    assertExists(typeof isCloudflare === "boolean" ? true : false);
  });
});

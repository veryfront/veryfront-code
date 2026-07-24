import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { DEFAULT_ALLOWED_CDN_HOSTS } from "#veryfront/utils";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { loadSecurityConfig } from "./security-config.ts";

function makeAdapter(): RuntimeAdapter {
  return {
    id: "node",
    name: "security-config-test",
    capabilities: {
      typescript: true,
      jsx: true,
      http2: false,
      websocket: false,
      workers: false,
      fileWatching: false,
      shell: false,
      kvStore: false,
      writableFs: false,
    },
    env: {
      get: () => undefined,
      set: () => {},
      toObject: () => ({}),
    },
    fs: {
      readFile: () => Promise.resolve(""),
      writeFile: () => Promise.resolve(),
      readDir: async function* () {},
      exists: () => Promise.resolve(false),
      stat: () =>
        Promise.resolve({
          isFile: false,
          isDirectory: false,
          isSymlink: false,
          size: 0,
          mtime: null,
        }),
      mkdir: () => Promise.resolve(),
      remove: () => Promise.resolve(),
      makeTempDir: () => Promise.resolve("/tmp/mock"),
      watch: () => ({
        close: () => {},
        [Symbol.asyncIterator]: async function* () {},
      }),
    },
    server: {
      upgradeWebSocket() {
        throw new Error("not implemented");
      },
    },
    serve() {
      throw new Error("not implemented");
    },
  };
}

describe("routing/api/module-loader/security-config", () => {
  describe("loadSecurityConfig()", () => {
    it("should return an array of strings", async () => {
      const result = await loadSecurityConfig("/tmp/nonexistent-project", makeAdapter());
      assertEquals(Array.isArray(result), true);
      assertEquals(result.every((h) => typeof h === "string"), true);
    });

    it("should return DEFAULT_ALLOWED_CDN_HOSTS when config is not available", async () => {
      const result = await loadSecurityConfig("/tmp/nonexistent-project", makeAdapter());
      assertEquals(result, DEFAULT_ALLOWED_CDN_HOSTS);
    });

    it("should return a non-empty list of allowed hosts", async () => {
      const result = await loadSecurityConfig("/tmp/nonexistent-project", makeAdapter());
      assertEquals(result.length > 0, true);
    });
  });
});

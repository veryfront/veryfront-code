import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { DEFAULT_ALLOWED_CDN_HOSTS } from "#veryfront/utils";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { loadSecurityConfig, resolvePreparedRemoteHosts } from "./security-config.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { join } from "#veryfront/compat/path";
import {
  MAX_REMOTE_HOST_COUNT,
  MAX_REMOTE_HOST_URL_LENGTH,
} from "#veryfront/utils/remote-host-policy-limits.ts";

const localFs = createFileSystem();

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

    it("returns DEFAULT_ALLOWED_CDN_HOSTS when the project has no config file", async () => {
      const result = await loadSecurityConfig("/tmp/nonexistent-project", makeAdapter());
      assertEquals(result, DEFAULT_ALLOWED_CDN_HOSTS);
    });

    it("should return a non-empty list of allowed hosts", async () => {
      const result = await loadSecurityConfig("/tmp/nonexistent-project", makeAdapter());
      assertEquals(result.length > 0, true);
    });

    it("propagates config load failures instead of widening to default hosts", async () => {
      const projectDir = await localFs.makeTempDir({ prefix: "vf-broken-security-config-" });
      const adapter = makeAdapter();
      adapter.fs.exists = localFs.exists.bind(localFs);
      await localFs.writeTextFile(
        join(projectDir, "veryfront.config.js"),
        `export default { security: { remoteHosts: "https://esm.sh" } };`,
      );

      try {
        await assertRejects(
          () => loadSecurityConfig(projectDir, adapter),
          Error,
          "Invalid veryfront.config",
        );
      } finally {
        await localFs.remove(projectDir, { recursive: true });
      }
    });
  });

  describe("resolvePreparedRemoteHosts()", () => {
    it("denies remote imports when no validated config snapshot is available", () => {
      assertEquals(resolvePreparedRemoteHosts(undefined), []);
    });

    it("uses defaults only for an available config with no explicit policy", () => {
      assertEquals(
        resolvePreparedRemoteHosts({} as VeryfrontConfig),
        DEFAULT_ALLOWED_CDN_HOSTS,
      );
    });

    it("preserves an explicit deny-all policy", () => {
      assertEquals(
        resolvePreparedRemoteHosts({
          security: { remoteHosts: [] },
        } as VeryfrontConfig),
        [],
      );
    });

    it("accepts policies at their exact count and URL length limits", () => {
      const prefix = "https://example.com/";
      const exactLengthUrl = prefix + "a".repeat(MAX_REMOTE_HOST_URL_LENGTH - prefix.length);
      const remoteHosts = Array.from(
        { length: MAX_REMOTE_HOST_COUNT },
        (_, index) => `https://host-${index}.example`,
      );
      remoteHosts[0] = exactLengthUrl;

      assertEquals(
        resolvePreparedRemoteHosts({
          security: { remoteHosts },
        } as VeryfrontConfig),
        remoteHosts,
      );
    });

    it("rejects policies above their count or URL length limits", () => {
      const prefix = "https://example.com/";
      const overLengthUrl = prefix +
        "a".repeat(MAX_REMOTE_HOST_URL_LENGTH + 1 - prefix.length);
      const overCountHosts = Array.from(
        { length: MAX_REMOTE_HOST_COUNT + 1 },
        (_, index) => `https://host-${index}.example`,
      );

      for (const remoteHosts of [overCountHosts, [overLengthUrl]]) {
        assertThrows(
          () =>
            resolvePreparedRemoteHosts({
              security: { remoteHosts },
            } as VeryfrontConfig),
          TypeError,
          "unavailable or malformed",
        );
      }
    });

    it("rejects malformed and accessor-backed policies without invoking accessors", () => {
      let accessorCalls = 0;
      const security = {};
      Object.defineProperty(security, "remoteHosts", {
        enumerable: true,
        get() {
          accessorCalls++;
          return DEFAULT_ALLOWED_CDN_HOSTS;
        },
      });

      assertThrows(
        () =>
          resolvePreparedRemoteHosts({
            security: { remoteHosts: "https://esm.sh" },
          } as unknown as VeryfrontConfig),
        TypeError,
        "unavailable or malformed",
      );
      assertThrows(
        () => resolvePreparedRemoteHosts({ security } as VeryfrontConfig),
        TypeError,
        "unavailable or malformed",
      );
      assertEquals(accessorCalls, 0);
    });

    it("uses captured numeric validation after ambient primordial poisoning", () => {
      const originalIsSafeInteger = Number.isSafeInteger;
      Number.isSafeInteger = () => {
        throw new Error("ambient numeric validator must not run");
      };

      try {
        assertEquals(
          resolvePreparedRemoteHosts({
            security: { remoteHosts: ["https://esm.sh"] },
          } as VeryfrontConfig),
          ["https://esm.sh"],
        );
      } finally {
        Number.isSafeInteger = originalIsSafeInteger;
      }
    });
  });
});

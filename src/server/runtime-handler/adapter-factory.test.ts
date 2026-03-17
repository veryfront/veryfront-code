import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { resolveAdapter } from "./adapter-factory.ts";
import { localAdapterCache, localProjectCache, ProjectDiscoveryCache } from "./local-project-discovery.ts";

function createMockAdapter(
  files: Record<string, { isDirectory: boolean; isFile?: boolean }>,
): RuntimeAdapter {
  return {
    id: "memory",
    name: "Memory",
    capabilities: {
      typescript: true,
      jsx: true,
      http2: false,
      websocket: true,
      workers: false,
      fileWatching: false,
      shell: false,
      kvStore: false,
      writableFs: true,
    },
    fs: {
      readFile: async () => "",
      writeFile: async () => {},
      exists: async (path: string) => path in files,
      readDir: async function* () {},
      stat: async (path: string) => {
        const entry = files[path];
        if (!entry) throw new Error(`Not found: ${path}`);
        return {
          size: 0,
          isFile: entry.isFile ?? !entry.isDirectory,
          isDirectory: entry.isDirectory,
          isSymlink: false,
          mtime: null,
        };
      },
      mkdir: async () => {},
      remove: async () => {},
      makeTempDir: async () => "/tmp/vf-test",
      watch: () => ({ close: () => {}, [Symbol.asyncIterator]: async function* () {} }),
    },
    env: {
      get: () => undefined,
      set: () => {},
      toObject: () => ({}),
    },
    server: {
      upgradeWebSocket: () => {
        throw new Error("Not implemented");
      },
    },
    serve: async () => ({
      stop: async () => {},
      addr: { hostname: "127.0.0.1", port: 0 },
    }),
  };
}

describe("adapter-factory", () => {
  afterEach(() => {
    localProjectCache.clear();
    localAdapterCache.clear();
  });

  it("ignores x-project-path override outside proxy mode", async () => {
    const adapter = createMockAdapter({
      "/trusted/project": { isDirectory: true },
      "/trusted/project/app": { isDirectory: true },
    });

    const result = await resolveAdapter({
      projectDir: "/base/project",
      adapter,
      config: undefined,
      projectSlug: "myproject",
      projectId: "proj_123",
      proxyToken: undefined,
      releaseId: undefined,
      proxyEnv: "preview",
      branch: null,
      environmentName: undefined,
      parsedDomain: {
        slug: null,
        branch: null,
        environment: null,
        isVeryfrontDomain: false,
        isDraft: false,
        allowIframeEmbed: false,
      },
      headerProjectPath: "/trusted/project",
      isProxyMode: false,
    });

    assertEquals(result.isLocalProject, false);
    assertEquals(result.projectDir, "/base/project");
    assertEquals(localProjectCache.has("myproject"), false);
  });

  it("accepts validated x-project-path override in proxy mode", async () => {
    const adapter = createMockAdapter({
      "/trusted/project": { isDirectory: true },
      "/trusted/project/app": { isDirectory: true },
    });

    // Prevent runtime.get() calls in local adapter branch.
    localAdapterCache.set("/trusted/project", adapter);

    const result = await resolveAdapter({
      projectDir: "/base/project",
      adapter,
      config: undefined,
      projectSlug: "myproject",
      projectId: "proj_123",
      proxyToken: undefined,
      releaseId: undefined,
      proxyEnv: "preview",
      branch: null,
      environmentName: undefined,
      parsedDomain: {
        slug: null,
        branch: null,
        environment: null,
        isVeryfrontDomain: false,
        isDraft: false,
        allowIframeEmbed: false,
      },
      headerProjectPath: "/trusted/project",
      isProxyMode: true,
    });

    assertEquals(result.isLocalProject, true);
    assertEquals(result.projectDir, "/trusted/project");
    assertEquals(localProjectCache.get("myproject"), "/trusted/project");
  });

  it("uses injected cache instead of default singleton", async () => {
    const cache = new ProjectDiscoveryCache();
    const adapter = createMockAdapter({
      "/trusted/project": { isDirectory: true },
      "/trusted/project/app": { isDirectory: true },
    });

    // Pre-populate the injected cache with an adapter to prevent runtime.get() calls
    cache.adapters.set("/trusted/project", adapter);

    const result = await resolveAdapter({
      projectDir: "/base/project",
      adapter,
      config: undefined,
      projectSlug: "myproject",
      projectId: "proj_123",
      proxyToken: undefined,
      releaseId: undefined,
      proxyEnv: "preview",
      branch: null,
      environmentName: undefined,
      parsedDomain: {
        slug: null,
        branch: null,
        environment: null,
        isVeryfrontDomain: false,
        isDraft: false,
        allowIframeEmbed: false,
      },
      headerProjectPath: "/trusted/project",
      isProxyMode: true,
      cache,
    });

    assertEquals(result.isLocalProject, true);
    assertEquals(result.projectDir, "/trusted/project");
    // Injected cache should have the project
    assertEquals(cache.projects.get("myproject"), "/trusted/project");
    // Default singleton should NOT be affected
    assertEquals(localProjectCache.has("myproject"), false);
  });
});

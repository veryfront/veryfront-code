import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  type BundleConfig,
  createBuildOptions,
  createHmrRuntime,
  createJitBuildOptions,
  createPreviewBuildOptions,
  getLoaderForPath,
  getReactCDNMapping,
  getReactExternals,
} from "./build-config.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";

// Create a minimal mock adapter for testing
function createMockAdapter(): RuntimeAdapter {
  return {
    id: "memory",
    name: "Test Adapter",
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
    fs: {
      async readFile(path: string): Promise<string> {
        return `// Mock file: ${path}`;
      },
      async writeFile(): Promise<void> {},
      async exists(): Promise<boolean> {
        return false;
      },
      async *readDir(): AsyncIterable<
        { name: string; isFile: boolean; isDirectory: boolean; isSymlink: boolean }
      > {},
      async stat(): Promise<
        {
          size: number;
          isFile: boolean;
          isDirectory: boolean;
          isSymlink: boolean;
          mtime: Date | null;
        }
      > {
        return { size: 0, isFile: true, isDirectory: false, isSymlink: false, mtime: new Date() };
      },
      async mkdir(): Promise<void> {},
      async remove(): Promise<void> {},
      async makeTempDir(): Promise<string> {
        return "/tmp/test";
      },
      watch(): never {
        throw new Error("Not implemented");
      },
    },
    env: {
      get(): string | undefined {
        return undefined;
      },
      set(): void {},
      toObject(): Record<string, string> {
        return {};
      },
    },
    server: {
      upgradeWebSocket(): never {
        throw new Error("Not implemented");
      },
    },
    async serve(): Promise<never> {
      throw new Error("Not implemented");
    },
  };
}

describe("bundler/build-config", () => {
  describe("getLoaderForPath", () => {
    it("should return tsx for .tsx files", () => {
      assertEquals(getLoaderForPath("/src/app.tsx"), "tsx");
    });

    it("should return ts for .ts files", () => {
      assertEquals(getLoaderForPath("/src/utils.ts"), "ts");
    });

    it("should return jsx for .jsx files", () => {
      assertEquals(getLoaderForPath("/src/component.jsx"), "jsx");
    });

    it("should return css for .css files", () => {
      assertEquals(getLoaderForPath("/styles/main.css"), "css");
    });

    it("should return json for .json files", () => {
      assertEquals(getLoaderForPath("/data/config.json"), "json");
    });

    it("should return js for .js files", () => {
      assertEquals(getLoaderForPath("/dist/bundle.js"), "js");
    });

    it("should return js for unknown extensions", () => {
      assertEquals(getLoaderForPath("/src/file.mjs"), "js");
    });
  });

  describe("getReactExternals", () => {
    it("should include core React packages", () => {
      const externals = getReactExternals();
      assertEquals(externals.includes("react"), true);
      assertEquals(externals.includes("react-dom"), true);
      assertEquals(externals.includes("react/jsx-runtime"), true);
    });

    it("should include react-dom/client", () => {
      const externals = getReactExternals();
      assertEquals(externals.includes("react-dom/client"), true);
    });

    it("should include jsx-dev-runtime", () => {
      const externals = getReactExternals();
      assertEquals(externals.includes("react/jsx-dev-runtime"), true);
    });
  });

  describe("getReactCDNMapping", () => {
    it("should return CDN URLs for React packages", () => {
      const mapping = getReactCDNMapping("18.3.1");
      assertExists(mapping["react"]);
      assertExists(mapping["react-dom"]);
      assertEquals(mapping["react"].includes("esm.sh"), true);
    });

    it("should include version in URLs", () => {
      const mapping = getReactCDNMapping("18.3.1");
      assertEquals(mapping["react"]?.includes("18.3.1"), true);
    });

    it("should use default version when not specified", () => {
      const mapping = getReactCDNMapping();
      assertExists(mapping["react"]);
      assertEquals(mapping["react"].includes("esm.sh"), true);
    });
  });

  describe("createBuildOptions", () => {
    const mockAdapter = createMockAdapter();

    it("should create valid build options for SSR target", () => {
      const config: BundleConfig = {
        projectId: "test-project",
        projectDir: "/test/project",
        adapter: mockAdapter,
        target: "ssr",
        entryPoints: ["/test/project/app.tsx"],
      };

      const options = createBuildOptions(config);
      assertEquals(options.bundle, true);
      assertEquals(options.format, "esm");
      assertEquals(options.platform, "node");
      assertEquals(options.write, false);
    });

    it("should create valid build options for browser target", () => {
      const config: BundleConfig = {
        projectId: "test-project",
        projectDir: "/test/project",
        adapter: mockAdapter,
        target: "browser",
        entryPoints: ["/test/project/app.tsx"],
      };

      const options = createBuildOptions(config);
      assertEquals(options.platform, "browser");
    });

    it("should enable sourcemaps in dev mode", () => {
      const config: BundleConfig = {
        projectId: "test-project",
        projectDir: "/test/project",
        adapter: mockAdapter,
        dev: true,
        target: "browser",
        entryPoints: ["/test/project/app.tsx"],
      };

      const options = createBuildOptions(config);
      assertEquals(options.sourcemap, "inline");
      assertEquals(options.minify, false);
    });

    it("should disable sourcemaps in production mode", () => {
      const config: BundleConfig = {
        projectId: "test-project",
        projectDir: "/test/project",
        adapter: mockAdapter,
        dev: false,
        target: "browser",
        entryPoints: ["/test/project/app.tsx"],
      };

      const options = createBuildOptions(config);
      assertEquals(options.sourcemap, false);
      assertEquals(options.minify, true);
    });

    it("should include custom external packages", () => {
      const config: BundleConfig = {
        projectId: "test-project",
        projectDir: "/test/project",
        adapter: mockAdapter,
        target: "ssr",
        entryPoints: ["/test/project/app.tsx"],
        external: ["some-package"],
      };

      const options = createBuildOptions(config);
      assertExists(options.external);
      assertEquals(options.external!.includes("some-package"), true);
    });
  });

  describe("createJitBuildOptions", () => {
    const mockAdapter = createMockAdapter();

    it("should create optimized production build options", () => {
      const config: BundleConfig = {
        projectId: "test-project",
        projectDir: "/test/project",
        adapter: mockAdapter,
        target: "ssr",
        entryPoints: ["/test/project/app.tsx"],
      };

      const options = createJitBuildOptions(config);
      assertEquals(options.minify, true);
      assertEquals(options.sourcemap, false);
      assertEquals(options.treeShaking, true);
      assertEquals(options.legalComments, "none");
    });
  });

  describe("createPreviewBuildOptions", () => {
    const mockAdapter = createMockAdapter();

    it("should create development build options", () => {
      const config: BundleConfig = {
        projectId: "test-project",
        projectDir: "/test/project",
        adapter: mockAdapter,
        target: "browser",
        entryPoints: ["/test/project/app.tsx"],
      };

      const options = createPreviewBuildOptions(config);
      assertEquals(options.minify, false);
      assertEquals(options.sourcemap, "inline");
    });

    it("should include HMR plugin", () => {
      const config: BundleConfig = {
        projectId: "test-project",
        projectDir: "/test/project",
        adapter: mockAdapter,
        target: "browser",
        entryPoints: ["/test/project/app.tsx"],
      };

      const options = createPreviewBuildOptions(config, 3001);
      assertExists(options.plugins);
      // The HMR plugin should be included
      const pluginNames = options.plugins!.map((p) => p.name);
      assertEquals(pluginNames.some((name) => name.includes("hmr")), true);
    });
  });

  describe("createHmrRuntime", () => {
    it("should generate HMR runtime code", () => {
      const runtime = createHmrRuntime("test-project", 3001);
      assertExists(runtime);
      assertEquals(runtime.includes("WebSocket"), true);
      assertEquals(runtime.includes("test-project"), true);
      assertEquals(runtime.includes("3001"), true);
    });

    it("should include reconnection logic", () => {
      const runtime = createHmrRuntime("test-project");
      assertEquals(runtime.includes("reconnect"), true);
    });

    it("should check for React Fast Refresh", () => {
      const runtime = createHmrRuntime("test-project");
      assertEquals(runtime.includes("__REACT_REFRESH_RUNTIME__"), true);
    });

    it("should fallback to full reload", () => {
      const runtime = createHmrRuntime("test-project");
      assertEquals(runtime.includes("location.reload"), true);
    });

    it("should use default port when not specified", () => {
      const runtime = createHmrRuntime("test-project");
      assertEquals(runtime.includes("3001"), true);
    });

    it("should use custom port when specified", () => {
      const runtime = createHmrRuntime("test-project", 4000);
      assertEquals(runtime.includes("4000"), true);
    });
  });
});

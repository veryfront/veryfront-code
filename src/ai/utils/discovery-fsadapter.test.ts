
import { assertEquals, assertStringIncludes } from "std/assert/mod.ts";
import { describe, it } from "std/testing/bdd.ts";
import type { FileSystemAdapter } from "../../platform/adapters/base.ts";

function createMockFsAdapter(files: Record<string, string>): FileSystemAdapter {
  return {
    readFile(path: string): Promise<string> {
      const content = files[path];
      if (content === undefined) {
        return Promise.reject(new Error(`File not found: ${path}`));
      }
      return Promise.resolve(content);
    },
    exists(path: string): Promise<boolean> {
      return Promise.resolve(path in files);
    },
    writeFile(_path: string, _content: string): Promise<void> {
      return Promise.reject(new Error("Write not supported in mock"));
    },
    async *readDir(_path: string) {
      const dir = _path.endsWith("/") ? _path : _path + "/";
      for (const filePath of Object.keys(files)) {
        if (filePath.startsWith(dir)) {
          const relativePath = filePath.slice(dir.length);
          if (!relativePath.includes("/")) {
            yield {
              name: relativePath,
              isFile: true,
              isDirectory: false,
              isSymlink: false,
            };
          }
        }
      }
    },
    stat(path: string) {
      const content = files[path];
      if (content === undefined) {
        return Promise.reject(new Error(`File not found: ${path}`));
      }
      return Promise.resolve({
        size: content.length,
        isFile: true,
        isDirectory: false,
        isSymlink: false,
        mtime: new Date(),
      });
    },
    mkdir(_path: string, _options?: { recursive?: boolean }): Promise<void> {
      return Promise.resolve();
    },
    remove(_path: string, _options?: { recursive?: boolean }): Promise<void> {
      return Promise.resolve();
    },
    makeTempDir(_prefix: string): Promise<string> {
      return Promise.resolve("/tmp/mock-temp");
    },
    watch(_paths: string | string[], _options?: { recursive?: boolean }) {
      return {
        async *[Symbol.asyncIterator]() {
        },
        close() {},
      };
    },
  };
}

describe("fsAdapter plugin", () => {
  it("should resolve files with explicit extensions", async () => {
    const files = {
      "/project/ai/tools/my-tool.ts": `
        import { helper } from "../../lib/helper.ts";
        export default { name: "my-tool", execute: () => helper() };
      `,
      "/project/lib/helper.ts": `
        export function helper() { return "helped"; }
      `,
    };

    const fsAdapter = createMockFsAdapter(files);

    assertEquals(await fsAdapter.exists("/project/ai/tools/my-tool.ts"), true);
    assertEquals(await fsAdapter.exists("/project/lib/helper.ts"), true);
    assertEquals(await fsAdapter.exists("/project/nonexistent.ts"), false);

    const content = await fsAdapter.readFile("/project/ai/tools/my-tool.ts");
    assertStringIncludes(content, "import { helper }");
  });

  it("should resolve files without extensions", async () => {
    const files = {
      "/project/ai/tools/my-tool.ts": `
        import { helper } from "../../lib/helper";
        export default { name: "my-tool", execute: () => helper() };
      `,
      "/project/lib/helper.ts": `
        export function helper() { return "helped"; }
      `,
    };

    const fsAdapter = createMockFsAdapter(files);

    assertEquals(await fsAdapter.exists("/project/lib/helper"), false);
    assertEquals(await fsAdapter.exists("/project/lib/helper.ts"), true);
  });

  it("should resolve index files for directory imports", async () => {
    const files = {
      "/project/ai/tools/my-tool.ts": `
        import { utils } from "../../lib/utils";
        export default { name: "my-tool", execute: () => utils() };
      `,
      "/project/lib/utils/index.ts": `
        export function utils() { return "utils"; }
      `,
    };

    const fsAdapter = createMockFsAdapter(files);

    assertEquals(await fsAdapter.exists("/project/lib/utils"), false);
    assertEquals(await fsAdapter.exists("/project/lib/utils.ts"), false);
    assertEquals(await fsAdapter.exists("/project/lib/utils/index.ts"), true);
  });
});

describe("fsAdapter integration", () => {
  it("should bundle tool with relative imports via esbuild plugin", async () => {
    const isDeno = "Deno" in globalThis;
    if (isDeno) {
      console.log("Skipping esbuild plugin test in Deno (WASM doesn't support plugins)");
      return;
    }

    const files = {
      "/project/ai/tools/github-tool.ts": `
        import { GitHubClient } from "../../lib/github-client.ts";
        import { z } from "zod";

        const client = new GitHubClient();

        export default {
          name: "github-tool",
          description: "Interact with GitHub",
          parameters: z.object({
            repo: z.string(),
          }),
          execute: async ({ repo }: { repo: string }) => {
            return client.getRepo(repo);
          },
        };
      `,
      "/project/lib/github-client.ts": `
        export class GitHubClient {
          async getRepo(name: string) {
            return { name, stars: 100 };
          }
        }
      `,
    };

    const fsAdapter = createMockFsAdapter(files);

    const { build } = await import("esbuild");

    const existsCache = new Map<string, boolean>();

    async function checkExists(filePath: string): Promise<boolean> {
      if (existsCache.has(filePath)) {
        return existsCache.get(filePath)!;
      }
      const exists = await fsAdapter.exists(filePath);
      existsCache.set(filePath, exists);
      return exists;
    }

    async function resolveWithExtensions(basePath: string): Promise<string | null> {
      if (/\.(ts|tsx|js|jsx|mjs|json)$/i.test(basePath)) {
        if (await checkExists(basePath)) {
          return basePath;
        }
        return null;
      }

      const extensions = [".ts", ".tsx", ".js", ".jsx", ".mjs"];
      for (const ext of extensions) {
        const fullPath = basePath + ext;
        if (await checkExists(fullPath)) {
          return fullPath;
        }
      }

      for (const ext of extensions) {
        const indexPath = `${basePath}/index${ext}`;
        if (await checkExists(indexPath)) {
          return indexPath;
        }
      }

      return null;
    }

    const fsAdapterPlugin = {
      name: "veryfront-fsadapter",
      // deno-lint-ignore no-explicit-any
      setup(build: any) {
        build.onResolve(
          { filter: /^\.\.?\
          async (args: { path: string; importer: string; resolveDir: string }) => {
            const { dirname, resolve } = await import("node:path");
            const importerDir = args.importer ? dirname(args.importer) : args.resolveDir;
            const basePath = resolve(importerDir, args.path);

            const resolvedPath = await resolveWithExtensions(basePath);
            if (resolvedPath) {
              return { path: resolvedPath, namespace: "fsadapter" };
            }

            return {
              errors: [{ text: `Could not resolve "${args.path}" from "${importerDir}"` }],
            };
          },
        );

        build.onLoad(
          { filter: /.*/, namespace: "fsadapter" },
          async (args: { path: string }) => {
            const { extname, dirname } = await import("node:path");
            const content = await fsAdapter.readFile(args.path);
            const ext = extname(args.path).toLowerCase();
            const loader = ext === ".tsx"
              ? "tsx"
              : ext === ".jsx"
              ? "jsx"
              : ext === ".ts"
              ? "ts"
              : "js";

            return {
              contents: content,
              loader,
              resolveDir: dirname(args.path),
            };
          },
        );
      },
    };

    const source = files["/project/ai/tools/github-tool.ts"];
    const result = await build({
      bundle: true,
      write: false,
      format: "esm",
      platform: "neutral",
      target: "es2022",
      plugins: [fsAdapterPlugin],
      external: ["zod", "ai", "ai
      external: ["zod", "ai", "ai/*", "@ai-sdk/*", "veryfront", "veryfront/*"],
      stdin: {
        contents: source,
        loader: "ts",
        resolveDir: "/project/ai/tools",
        sourcefile: "/project/ai/tools/github-tool.ts",
      },
    });

    // Verify the bundle was created
    assertEquals(result.errors.length, 0, "Should have no errors");
    assertEquals(result.outputFiles?.length, 1, "Should have one output file");

    const bundledCode = result.outputFiles?.[0]?.text ?? "";

    // The GitHubClient should be bundled inline (not an external import)
    assertStringIncludes(bundledCode, "GitHubClient", "Should contain GitHubClient class");
    assertStringIncludes(bundledCode, "getRepo", "Should contain getRepo method");

    // zod should remain as external import
    assertStringIncludes(bundledCode, 'from "zod"', "Should have external zod import");
  });

  it("should handle nested relative imports", async () => {
    const isDeno = "Deno" in globalThis;
    if (isDeno) {
      console.log("Skipping esbuild plugin test in Deno");
      return;
    }

    const files = {
      "/project/ai/tools/tool.ts": `
        import { api } from "../../lib/api.ts";
        export default { execute: () => api() };
      `,
      "/project/lib/api.ts": `
        import { http } from "./http.ts";
        export function api() { return http.get("/"); }
      `,
      "/project/lib/http.ts": `
        export const http = {
          get: (url: string) => ({ url, data: "response" })
        };
      `,
    };

    const fsAdapter = createMockFsAdapter(files);
    const { build } = await import("esbuild");

    const existsCache = new Map<string, boolean>();
    const checkExists = async (p: string) => {
      if (!existsCache.has(p)) existsCache.set(p, await fsAdapter.exists(p));
      return existsCache.get(p)!;
    };

    const resolveWithExtensions = async (basePath: string): Promise<string | null> => {
      if (/\.(ts|tsx|js|jsx|mjs|json)$/i.test(basePath)) {
        return (await checkExists(basePath)) ? basePath : null;
      }
      for (const ext of [".ts", ".tsx", ".js", ".jsx", ".mjs"]) {
        if (await checkExists(basePath + ext)) return basePath + ext;
      }
      return null;
    };

    const plugin = {
      name: "fsadapter",
      // deno-lint-ignore no-explicit-any
      setup(build: any) {
        build.onResolve(
          { filter: /^\.\.?\// },
          async (args: { path: string; importer: string; resolveDir: string }) => {
            const { dirname, resolve } = await import("node:path");
            const importerDir = args.importer ? dirname(args.importer) : args.resolveDir;
            const resolved = await resolveWithExtensions(resolve(importerDir, args.path));
            return resolved
              ? { path: resolved, namespace: "fsadapter" }
              : { errors: [{ text: `Not found: ${args.path}` }] };
          },
        );

        build.onLoad({ filter: /.*/, namespace: "fsadapter" }, async (args: { path: string }) => {
          const { extname, dirname } = await import("node:path");
          const content = await fsAdapter.readFile(args.path);
          const ext = extname(args.path).toLowerCase();
          return {
            contents: content,
            loader: ext === ".tsx" ? "tsx" : ext === ".ts" ? "ts" : "js",
            resolveDir: dirname(args.path),
          };
        });
      },
    };

    const result = await build({
      bundle: true,
      write: false,
      format: "esm",
      platform: "neutral",
      plugins: [plugin],
      external: [],
      stdin: {
        contents: files["/project/ai/tools/tool.ts"],
        loader: "ts",
        resolveDir: "/project/ai/tools",
        sourcefile: "/project/ai/tools/tool.ts",
      },
    });

    assertEquals(result.errors.length, 0, "Should have no errors");

    const bundledCode = result.outputFiles?.[0]?.text ?? "";

    assertStringIncludes(bundledCode, "api", "Should contain api function");
    assertStringIncludes(bundledCode, "http", "Should contain http object");
    assertStringIncludes(bundledCode, "get", "Should contain get method");

    assertEquals(bundledCode.includes('from "../'), false, "Should not have relative imports");
    assertEquals(bundledCode.includes('from "./'), false, "Should not have relative imports");
  });
});

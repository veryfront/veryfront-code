import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  type BatchHandlerOptions,
  clearBatchCache,
  handleModuleBatch,
} from "./module-batch-handler.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { createImportMapIdentity } from "#veryfront/modules/import-map/index.ts";

describe(
  "modules/server/module-batch-handler",
  { sanitizeResources: false, sanitizeOps: false },
  () => {
    describe("handleModuleBatch", () => {
      function createBatchRequest(paths?: string, extraParams?: string): Request {
        const url = new URL("http://localhost:8080/_vf_modules/_batch");

        if (paths !== undefined) url.searchParams.set("paths", paths);
        if (extraParams) {
          const extra = new URLSearchParams(extraParams);
          for (const [key, value] of extra) url.searchParams.append(key, value);
        }

        return new Request(url.toString());
      }

      function createOptions(
        overrides: Partial<BatchHandlerOptions> = {},
      ): BatchHandlerOptions {
        return {
          projectDir: "/test-project",
          adapter: createMockAdapter(),
          projectSlug: "test",
          dev: true,
          ...overrides,
        };
      }

      function extractChildVersion(code: string): string {
        const match = code.match(/\.\/child\.js\?ssr=true&project=test&v=([^"']+)/);
        return match?.[1] ?? "";
      }

      it("should return 400 when paths parameter is missing", async () => {
        const response = await handleModuleBatch(createBatchRequest(), createOptions());
        assertEquals(response.status, 400);
        assertEquals(await response.text(), "Missing 'paths' parameter");
      });

      it("should return 400 when paths parameter is empty string", async () => {
        const response = await handleModuleBatch(createBatchRequest(""), createOptions());
        assertEquals(response.status, 400);
        assertEquals(await response.text(), "Missing 'paths' parameter");
      });

      it("should return 400 when paths has only whitespace/commas", async () => {
        const response = await handleModuleBatch(createBatchRequest(",,,"), createOptions());
        assertEquals(response.status, 400);
        assertEquals(await response.text(), "No valid paths provided");
      });

      it("should return 400 when too many modules requested", async () => {
        const paths = Array.from({ length: 101 }, (_, i) => `module${i}.js`).join(",");
        const response = await handleModuleBatch(createBatchRequest(paths), createOptions());
        assertEquals(response.status, 400);
        assertEquals((await response.text()).includes("Too many modules"), true);
      });

      it("rejects unsafe and duplicate module paths before filesystem lookup", async () => {
        const adapter = createMockAdapter();
        let statCalls = 0;
        const originalStat = adapter.fs.stat.bind(adapter.fs);
        adapter.fs.stat = (path) => {
          statCalls++;
          return originalStat(path);
        };
        const options = createOptions({ adapter });

        const unsafe = await handleModuleBatch(
          createBatchRequest("../secret.js"),
          options,
        );
        assertEquals(unsafe.status, 400);
        assertEquals(await unsafe.text(), "Invalid module path");

        const duplicate = await handleModuleBatch(
          createBatchRequest("page.js,page.js"),
          options,
        );
        assertEquals(duplicate.status, 400);
        assertEquals(await duplicate.text(), "Duplicate module paths are not allowed");
        assertEquals(statCalls, 0);
      });

      it("should return 404 when no modules could be loaded", async () => {
        const response = await handleModuleBatch(
          createBatchRequest("nonexistent.js"),
          createOptions(),
        );
        assertEquals(response.status, 404);
        assertEquals(await response.text(), "No modules could be loaded");
      });

      it("caches missing module lookups", async () => {
        clearBatchCache();
        const adapter = createMockAdapter();
        const originalStat = adapter.fs.stat;
        let statCalls = 0;
        adapter.fs.stat = (path: string) => {
          statCalls++;
          return originalStat(path);
        };
        const options = createOptions({ adapter });

        const firstResponse = await handleModuleBatch(
          createBatchRequest("components/Missing.js"),
          options,
        );
        assertEquals(firstResponse.status, 404);
        const afterFirstMiss = statCalls;
        assertEquals(afterFirstMiss > 0, true);

        const secondResponse = await handleModuleBatch(
          createBatchRequest("components/Missing.js"),
          options,
        );
        assertEquals(secondResponse.status, 404);
        assertEquals(statCalls, afterFirstMiss);
      });

      it("scopes missing module lookups by project identity", async () => {
        clearBatchCache();

        const missingAdapter = createMockAdapter();
        const firstResponse = await handleModuleBatch(
          createBatchRequest("components/Missing.js"),
          {
            projectDir: "/shared-project-dir",
            adapter: missingAdapter,
            projectId: "project-a",
            projectSlug: "project-a",
            dev: true,
          },
        );
        assertEquals(firstResponse.status, 404);

        const presentAdapter = createMockAdapter();
        presentAdapter.fs.files.set(
          "/shared-project-dir/components/Missing.tsx",
          "export const value = 1;",
        );
        const secondResponse = await handleModuleBatch(
          createBatchRequest("components/Missing.js"),
          {
            projectDir: "/shared-project-dir",
            adapter: presentAdapter,
            projectId: "project-b",
            projectSlug: "project-b",
            dev: true,
          },
        );

        assertEquals(secondResponse.status, 200);
      });

      it("should successfully batch existing modules", async () => {
        const adapter = createMockAdapter();
        adapter.fs.files.set(
          "/test-project/hello.tsx",
          "export default function Hello() { return null; }",
        );

        const response = await handleModuleBatch(createBatchRequest("hello.js"), {
          projectDir: "/test-project",
          adapter,
          projectSlug: "test",
          dev: true,
        });

        assertEquals(response.status, 200);
        assertEquals(
          response.headers.get("Content-Type"),
          "application/javascript; charset=utf-8",
        );
        assertEquals(response.headers.get("X-Batch-Modules"), "1");

        const code = await response.text();
        assertEquals(code.includes("__vf_batch_modules"), true);
        assertEquals(code.includes("getModule"), true);
      });

      it("isolates hosted SSR transforms by bound import map without ambient config probes", async () => {
        clearBatchCache();
        const adapter = createMockAdapter();
        adapter.fs.files.set(
          "/test-project/page.ts",
          `import mapped from "package"; export default mapped;`,
        );
        let ambientConfigProbes = 0;
        const isConfigPath = (path: string) =>
          /(?:^|\/)(?:deno\.json|veryfront\.config(?:\.[cm]?[jt]s)?)$/.test(path);
        const originalReadFile = adapter.fs.readFile.bind(adapter.fs);
        const originalExists = adapter.fs.exists.bind(adapter.fs);
        const originalStat = adapter.fs.stat.bind(adapter.fs);
        adapter.fs.readFile = (path) => {
          if (isConfigPath(path)) ambientConfigProbes++;
          return originalReadFile(path);
        };
        adapter.fs.exists = (path) => {
          if (isConfigPath(path)) ambientConfigProbes++;
          return originalExists(path);
        };
        adapter.fs.stat = (path) => {
          if (isConfigPath(path)) ambientConfigProbes++;
          return originalStat(path);
        };

        const mapA = await createImportMapIdentity({
          imports: { package: "node:fs" },
          scopes: {},
        });
        const mapB = await createImportMapIdentity({
          imports: { package: "node:path" },
          scopes: {},
        });
        const request = createBatchRequest("page.js", "ssr=true");
        const baseOptions = {
          projectDir: "/test-project",
          adapter,
          projectId: "project-1",
          projectSlug: "test",
          branch: "main",
          releaseId: "release-1",
          reactVersion: "19.1.1",
          dev: false,
        } as const;

        const responseA = await handleModuleBatch(request, {
          ...baseOptions,
          importMapIdentity: mapA,
        });
        const responseB = await handleModuleBatch(request, {
          ...baseOptions,
          importMapIdentity: mapB,
        });
        const [codeA, codeB] = await Promise.all([responseA.text(), responseB.text()]);

        assertEquals(responseA.status, 200);
        assertEquals(responseB.status, 200);
        assertStringIncludes(codeA, "node:fs");
        assertEquals(codeA.includes("node:path"), false);
        assertStringIncludes(codeB, "node:path");
        assertEquals(codeB.includes("node:fs"), false);
        assertEquals(ambientConfigProbes, 0);
      });

      it("streams batch bundles without joining the full response", async () => {
        clearBatchCache();
        const adapter = createMockAdapter();
        adapter.fs.files.set("/test-project/streamed.tsx", "export const streamed = true;");
        const options = {
          projectDir: "/test-project",
          adapter,
          projectSlug: "test",
          dev: false,
        };

        const firstResponse = await handleModuleBatch(createBatchRequest("streamed.js"), options);
        assertEquals(firstResponse.status, 200);
        await firstResponse.text();

        const originalJoin = Array.prototype.join;
        Array.prototype.join = function patchedJoin(this: unknown[], separator?: string) {
          if (this[0] === "// Veryfront Module Batch Bundle") {
            throw new Error("full bundle join should not be used");
          }
          return originalJoin.call(this, separator);
        };

        try {
          const secondResponse = await handleModuleBatch(
            createBatchRequest("streamed.js"),
            options,
          );
          assertEquals(secondResponse.status, 200);
          const code = await secondResponse.text();
          assertEquals(code.includes("__vf_batch_modules"), true);
          assertEquals(code.includes("streamed.js"), true);
        } finally {
          Array.prototype.join = originalJoin;
        }
      });

      it("should include batch metadata headers", async () => {
        const adapter = createMockAdapter();
        adapter.fs.files.set("/test-project/page.tsx", "export default () => null;");

        const response = await handleModuleBatch(createBatchRequest("page.js"), {
          projectDir: "/test-project",
          adapter,
          projectSlug: "test",
          dev: true,
        });

        assertEquals(response.status, 200);
        assertEquals(response.headers.has("X-Batch-Duration"), true);
        assertEquals(response.headers.has("X-Batch-Slow"), true);
      });

      it("should handle mix of existing and missing modules", async () => {
        const adapter = createMockAdapter();
        adapter.fs.files.set("/test-project/exists.tsx", "export const x = 1;");

        const response = await handleModuleBatch(
          createBatchRequest("exists.js,missing.js"),
          {
            projectDir: "/test-project",
            adapter,
            projectSlug: "test",
            dev: true,
          },
        );

        assertEquals(response.status, 200);
        const code = await response.text();
        assertEquals(code.includes("exists.js"), true);
        assertEquals(code.includes("missing.js"), true);
        assertEquals(code.includes("__vf_error"), true);
      });

      it("JSON-encodes module paths and failure messages in generated output", async () => {
        const adapter = createMockAdapter();
        adapter.fs.files.set(
          '/test-project/quo"te.tsx',
          "export const safe = true;",
        );
        const originalStat = adapter.fs.stat.bind(adapter.fs);
        adapter.fs.stat = (path) => {
          if (path.includes("/bad.")) {
            return Promise.reject(new Error('"; globalThis.injected = true; //'));
          }
          return originalStat(path);
        };

        const response = await handleModuleBatch(
          createBatchRequest('quo"te.js,bad.js'),
          createOptions({ adapter }),
        );

        assertEquals(response.status, 200);
        const code = await response.text();
        assertStringIncludes(
          code,
          `__vf_batch_modules.set("quo\\"te.js", __mod_0);`,
        );
        assertStringIncludes(
          code,
          `__vf_error: "\\"; globalThis.injected = true; //"`,
        );
        assertEquals(code.includes("// Generated:"), false);
      });

      it("does not mark identity-free batch URLs immutable", async () => {
        const adapter = createMockAdapter();
        adapter.fs.files.set("/test-project/comp.tsx", "export const y = 2;");

        const response = await handleModuleBatch(createBatchRequest("comp.js"), {
          projectDir: "/test-project",
          adapter,
          projectSlug: "test",
          dev: false,
        });

        assertEquals(response.status, 200);
        assertEquals(response.headers.get("Cache-Control"), "no-cache");
      });

      it("uses child source content for SSR import cache busters", async () => {
        const adapter = createMockAdapter();
        adapter.fs.files.set(
          "/test-project/page.ts",
          `import { child } from "./child.js";\nexport const page = child;\n`,
        );
        adapter.fs.files.set("/test-project/child.ts", `export const child = "one";\n`);

        const firstResponse = await handleModuleBatch(
          createBatchRequest("page.js", "ssr=true"),
          {
            projectDir: "/test-project",
            adapter,
            projectSlug: "test",
            dev: true,
          },
        );
        assertEquals(firstResponse.status, 200);
        const firstVersion = extractChildVersion(await firstResponse.text());

        adapter.fs.files.set("/test-project/child.ts", `export const child = "two";\n`);

        const secondResponse = await handleModuleBatch(
          createBatchRequest("page.js", "ssr=true"),
          {
            projectDir: "/test-project",
            adapter,
            projectSlug: "test",
            dev: true,
          },
        );
        assertEquals(secondResponse.status, 200);
        const secondVersion = extractChildVersion(await secondResponse.text());

        assertEquals(firstVersion.length > 0, true);
        assertEquals(secondVersion.length > 0, true);
        assertEquals(firstVersion !== secondVersion, true);
      });
    });
  },
);

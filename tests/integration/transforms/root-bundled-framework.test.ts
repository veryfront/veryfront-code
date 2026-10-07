import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { makeTempDir } from "#veryfront/testing/deno-compat.ts";
import { stop as stopEsbuild } from "veryfront/extensions/bundler";
import { join } from "#veryfront/compat/path/index.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import {
  resolveAndTransformVeryfrontImport,
  transformFrameworkCode,
} from "#veryfront/transforms/pipeline/stages/ssr-vf-modules/transform.ts";
import {
  FRAMEWORK_ROOT,
  MAX_RELATIVE_IMPORT_DEPTH,
} from "#veryfront/transforms/pipeline/stages/ssr-vf-modules/constants.ts";

describe("root-bundled framework SSR", () => {
  it("resolves root-bundled extensions without fetching unpublished npm packages", async () => {
    const tmp = await makeTempDir({ prefix: "vf-root-bundled-ssr-" });
    const requests: string[] = [];
    try {
      const transformed = await withMockFetch((input) => {
        const url = input instanceof Request ? input.url : String(input);
        requests.push(url);
        throw new Error(`Unexpected remote dependency: ${url}`);
      }, () =>
        transformFrameworkCode(
          'import factory from "@veryfront/ext-eval-report-mlflow"; export default factory;',
          join(FRAMEWORK_ROOT, "src", "extensions", "builtin-extensions.ts"),
          { reactVersion: "19.2.4", projectDir: tmp, fs: createFileSystem() },
          true,
        ));
      assertEquals(requests, []);
      assertEquals(transformed.includes("@veryfront/ext-eval-report-mlflow"), false);
      assertStringIncludes(transformed, "file://");
      const factoryUrl = transformed.match(/from "(file:[^"]+)"/)?.[1];
      assert(factoryUrl, "Root-bundled factory must resolve to a loadable module");
      const { default: factory } = await import(factoryUrl);
      const extension = factory({ trackingUri: "https://mlflow.example.test" });
      assertEquals(extension.name, "ext-eval-report-mlflow");
      let exporter: { id: string } | undefined;
      let removedId: string | undefined;
      extension.setup({
        require: (name: string) => {
          assertEquals(name, "EvalReportExporterRegistry");
          return {
            register: (value: { id: string }) => {
              exporter = value;
            },
            unregister: (id: string) => {
              removedId = id;
            },
          };
        },
        logger: { debug() {} },
      });
      assertEquals(exporter?.id, "mlflow");
      extension.teardown();
      assertEquals(removedId, "mlflow");
      const fallback = await withMockFetch(() => {
        throw new Error("Root-bundled fallback must not fetch an unpublished package");
      }, () =>
        transformFrameworkCode(
          'import factory from "@veryfront/ext-eval-report-mlflow"; export default factory;',
          join(FRAMEWORK_ROOT, "src", "extensions", "builtin-extensions.ts"),
          { reactVersion: "19.2.4", projectDir: tmp, fs: createFileSystem() },
          true,
          MAX_RELATIVE_IMPORT_DEPTH + 1,
        ));
      assertStringIncludes(fallback, factoryUrl);
    } finally {
      await stopEsbuild();
      await Deno.remove(tmp, { recursive: true });
    }
  });

  it("shares cached module identity between public and internal SDK imports", async () => {
    const tmp = await makeTempDir({ prefix: "vf-sdk-module-identity-" });
    try {
      const ctx = { reactVersion: "19.2.4", projectDir: tmp, fs: createFileSystem() };
      const publicUrl = await resolveAndTransformVeryfrontImport("veryfront/platform/env", ctx);
      const internalUrl = await resolveAndTransformVeryfrontImport(
        "#veryfront/platform/env.ts",
        ctx,
      );
      assert(publicUrl);
      assertEquals(publicUrl, internalUrl);
    } finally {
      await stopEsbuild();
      await Deno.remove(tmp, { recursive: true });
    }
  });
});

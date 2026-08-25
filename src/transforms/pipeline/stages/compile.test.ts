import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertExists,
  assertInstanceOf,
  assertRejects,
  assertStrictEquals,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import { stop as stopEsbuild } from "#veryfront/platform/compat/esbuild.ts";
import { VeryfrontError } from "#veryfront/errors";
import type { Bundler } from "#veryfront/extensions/bundler/bundler.ts";
import {
  register as registerContract,
  tryResolve as tryResolveContract,
  unregister as unregisterContract,
} from "#veryfront/extensions/contracts.ts";
import { compilePlugin } from "./compile.ts";
import { TransformStage } from "../types.ts";
import type { TransformContext } from "../types.ts";

function createContext(code: string, filePath = "/project/lib/x.ts"): TransformContext {
  return {
    code,
    originalSource: code,
    filePath,
    projectDir: "/project",
    projectId: "project",
    target: "ssr",
    dev: true,
    contentHash: "hash",
    jsxImportSource: "react",
    timing: new Map(),
    debug: false,
    metadata: new Map(),
    reactVersion: "19.1.1",
  } as TransformContext;
}

async function transformWithBundlerFailure(cause: Error): Promise<VeryfrontError> {
  const previous = tryResolveContract<Bundler>("Bundler");
  registerContract<Bundler>("Bundler", {
    bundle: () => Promise.reject(new Error("not used")),
    transform: () => Promise.reject(cause),
  });

  try {
    const error = await assertRejects(
      async () => await compilePlugin.transform(createContext("export const value = 1;")),
      VeryfrontError,
    );
    assertInstanceOf(error, VeryfrontError);
    return error;
  } finally {
    if (previous) registerContract("Bundler", previous);
    else unregisterContract("Bundler");
  }
}

describe("transforms/pipeline/stages/compile", () => {
  afterAll(async () => {
    await stopEsbuild();
  });

  describe("compilePlugin metadata", () => {
    it("has name 'esbuild-compile'", () => {
      assertEquals(compilePlugin.name, "esbuild-compile");
    });

    it("runs at COMPILE stage", () => {
      assertEquals(compilePlugin.stage, TransformStage.COMPILE);
    });

    it("has a transform function", () => {
      assertExists(compilePlugin.transform);
      assertEquals(typeof compilePlugin.transform, "function");
    });

    it("has no condition (always runs)", () => {
      assertEquals(compilePlugin.condition, undefined);
    });
  });

  describe("import attributes", () => {
    // esbuild lowers to es2020, which pre-dates import attributes. Without an
    // explicit `supported` override it silently drops `with { type: "json" }`,
    // and the runtime then refuses the module with "Attempted to load JSON
    // module without specifying \"type\": \"json\"".
    it('preserves `with { type: "json" }` on a static import', async () => {
      const result = await compilePlugin.transform(
        createContext(
          `import manifest from "./manifest.json" with { type: "json" };\nexport const x = manifest;`,
        ),
      );

      assertStringIncludes(result, 'with { type: "json" }');
    });

    it("preserves the attribute on a dynamic import", async () => {
      const result = await compilePlugin.transform(
        createContext(
          `export async function load() { return await import("./manifest.json", { with: { type: "json" } }); }`,
        ),
      );

      assertStringIncludes(result, 'type: "json"');
    });

    // `assert { type: "json" }` is the withdrawn spelling of the same clause.
    // esbuild treats it as its own feature and drops it even when import
    // attributes are enabled, so the compiler upgrades it to `with` instead.
    // Emitting `assert` verbatim is not an option: Node 22 and Deno 2 reject
    // the keyword outright.
    it("upgrades a legacy static assertion to an import attribute", async () => {
      const result = await compilePlugin.transform(
        createContext(
          `import manifest from "./manifest.json" assert { type: "json" };\nexport const x = manifest;`,
        ),
      );

      assertStringIncludes(result, 'with { type: "json" }');
      assertEquals(result.includes("assert"), false);
    });

    it("upgrades a legacy assertion on a re-export", async () => {
      const result = await compilePlugin.transform(
        createContext(`export { name } from "./manifest.json" assert { type: "json" };`),
      );

      assertStringIncludes(result, 'with { type: "json" }');
      assertEquals(result.includes("assert"), false);
    });

    it("upgrades a legacy assertion on a dynamic import", async () => {
      const result = await compilePlugin.transform(
        createContext(
          `export async function load() { return await import("./manifest.json", { assert: { type: "json" } }); }`,
        ),
      );

      assertStringIncludes(result, 'with: { type: "json" }');
      assertEquals(result.includes("assert"), false);
    });

    it("leaves import-like text inside a string literal alone", async () => {
      const source = 'export const TPL = `import d from "./a.json" assert { type: "json" };`;\n';
      const result = await compilePlugin.transform(createContext(source));

      assertStringIncludes(result, 'import d from "./a.json" assert { type: "json" };');
    });
  });

  describe("modern ESM syntax", () => {
    it("accepts top-level await in framework server modules", async () => {
      const result = await compilePlugin.transform(
        createContext(
          `const serverMode = await Promise.resolve("production");\nexport { serverMode };`,
          "/project/src/server/production-server.ts",
        ),
      );

      assertStringIncludes(result, 'await Promise.resolve("production")');
    });
  });

  describe("error classification", () => {
    it("marks esbuild source diagnostics as tenant build failures", async () => {
      const error = await assertRejects(
        async () => await compilePlugin.transform(createContext("export const value = ;")),
        VeryfrontError,
      );

      assertInstanceOf(error, VeryfrontError);
      assertEquals(error.slug, "compilation-error");
      assertEquals(
        (error.context as { tenantBuildFailure?: unknown } | undefined)?.tenantBuildFailure,
        true,
      );
    });

    it("does not use an inherited esbuild diagnostic collection", async () => {
      const marker = Symbol.for("veryfront.bundler.esbuild-source-diagnostic");
      const previousErrors = Object.getOwnPropertyDescriptor(Error.prototype, "errors");
      const previousMarker = Object.getOwnPropertyDescriptor(Error.prototype, marker);
      const frameworkFailure = new Error("esbuild service stopped");
      Object.defineProperty(Error.prototype, "errors", {
        configurable: true,
        value: [{ location: { line: 1, column: 1 } }],
      });
      Object.defineProperty(Error.prototype, marker, { configurable: true, value: true });

      try {
        const error = await transformWithBundlerFailure(frameworkFailure);
        assertStrictEquals(error.cause, frameworkFailure);
        assertEquals(
          (error.context as { tenantBuildFailure?: unknown } | undefined)?.tenantBuildFailure,
          false,
        );
      } finally {
        if (previousErrors) Object.defineProperty(Error.prototype, "errors", previousErrors);
        else delete (Error.prototype as { errors?: unknown }).errors;
        if (previousMarker) Object.defineProperty(Error.prototype, marker, previousMarker);
        else delete (Error.prototype as { [marker]?: unknown })[marker];
      }
    });

    it("does not use inherited esbuild diagnostic locations", async () => {
      const frameworkFailure = new Error("esbuild service stopped");
      Object.defineProperty(frameworkFailure, "errors", {
        value: [Object.create({ location: { line: 1, column: 1 } })],
      });

      const error = await transformWithBundlerFailure(frameworkFailure);
      assertStrictEquals(error.cause, frameworkFailure);
      assertEquals(
        (error.context as { tenantBuildFailure?: unknown } | undefined)?.tenantBuildFailure,
        false,
      );
    });

    it("does not invoke accessor-backed esbuild diagnostic fields", async () => {
      const marker = Symbol.for("veryfront.bundler.esbuild-source-diagnostic");
      let errorsGetterReads = 0;
      let markerGetterReads = 0;
      const accessorCollectionFailure = new Error("esbuild service stopped");
      Object.defineProperty(accessorCollectionFailure, "errors", {
        get() {
          errorsGetterReads++;
          return [{ location: { line: 1, column: 1 } }];
        },
      });
      Object.defineProperty(accessorCollectionFailure, marker, {
        get() {
          markerGetterReads++;
          return true;
        },
      });

      const collectionError = await transformWithBundlerFailure(accessorCollectionFailure);
      assertEquals(
        (collectionError.context as { tenantBuildFailure?: unknown } | undefined)
          ?.tenantBuildFailure,
        false,
      );
      assertEquals(errorsGetterReads, 0);
      assertEquals(markerGetterReads, 0);

      let locationGetterReads = 0;
      const diagnostic = Object.defineProperty({}, "location", {
        get() {
          locationGetterReads++;
          return { line: 1, column: 1 };
        },
      });
      const accessorLocationFailure = new Error("esbuild service stopped");
      Object.defineProperty(accessorLocationFailure, "errors", { value: [diagnostic] });

      const locationError = await transformWithBundlerFailure(accessorLocationFailure);
      assertEquals(
        (locationError.context as { tenantBuildFailure?: unknown } | undefined)
          ?.tenantBuildFailure,
        false,
      );
      assertEquals(locationGetterReads, 0);
    });

    // By the time an `.mdx` file reaches COMPILE, PARSE has already turned the
    // tenant's source into JSX, so `ctx.code` is the framework's MDX-compiler
    // output. A remark/rehype/recma plugin emitting broken JSX still yields an
    // esbuild diagnostic with a valid location — pointing into generated code.
    // Claiming tenant ownership there would downgrade a broken content-MDX
    // release to a Sentry warning and nobody would be paged.
    it("does not claim tenant ownership of a diagnostic in MDX-compiler output", async () => {
      const error = await assertRejects(
        async () =>
          await compilePlugin.transform(
            createContext("export const value = ;", "/project/app/post.mdx"),
          ),
        VeryfrontError,
      );

      assertInstanceOf(error, VeryfrontError);
      assertEquals(error.slug, "compilation-error");
      assertEquals(
        (error.context as { tenantBuildFailure?: unknown } | undefined)?.tenantBuildFailure,
        false,
      );
    });

    it("does not claim tenant ownership of a diagnostic in Markdown-compiler output", async () => {
      const error = await assertRejects(
        async () =>
          await compilePlugin.transform(
            createContext("export const value = ;", "/project/app/post.md"),
          ),
        VeryfrontError,
      );

      assertInstanceOf(error, VeryfrontError);
      assertEquals(
        (error.context as { tenantBuildFailure?: unknown } | undefined)?.tenantBuildFailure,
        false,
      );
    });
  });

  // The MDX loader resolves a page's layout by preferring an exported
  // `MDXLayout`. The MDX compiler declares the binding but does not export it,
  // so COMPILE has to add the export - after esbuild has run, and before the
  // inline sourcemap directive esbuild leaves last in dev.
  describe("MDX layout export injection", () => {
    const declaresLayout =
      `import Layout from "./Layout.js";\nconst MDXLayout = Layout;\nexport default function MDXContent(){ return null; }\n`;

    it("exports a declared but unexported MDXLayout", async () => {
      const result = await compilePlugin.transform(
        createContext(declaresLayout, "/project/app/post.mdx"),
      );

      assertStringIncludes(
        result,
        "export { MDXLayout };",
        "an MDX module that declares MDXLayout must export it for the loader to find",
      );
    });

    it("injects the export before the inline sourcemap directive", async () => {
      const result = await compilePlugin.transform(
        createContext(declaresLayout, "/project/app/post.mdx"),
      );

      const exportIndex = result.indexOf("export { MDXLayout };");
      const sourceMapIndex = result.indexOf("//# sourceMappingURL=");
      assertEquals(
        exportIndex > -1 && sourceMapIndex > -1 && exportIndex < sourceMapIndex,
        true,
        "the injected export must precede esbuild's trailing sourcemap directive",
      );
    });

    it("does not duplicate an MDXLayout export that is already present", async () => {
      const result = await compilePlugin.transform(
        createContext(
          `import Layout from "./Layout.js";\nconst MDXLayout = Layout;\nexport { MDXLayout };\nexport default function MDXContent(){ return null; }\n`,
          "/project/app/post.mdx",
        ),
      );

      assertEquals(
        result.match(/export\s*\{[^}]*MDXLayout/g)?.length,
        1,
        "an MDX module that already exports MDXLayout must not get a second export",
      );
    });
  });
});

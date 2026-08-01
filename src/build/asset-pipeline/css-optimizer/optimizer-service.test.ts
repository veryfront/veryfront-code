import "#veryfront/schemas/_test-setup.ts";
import { join } from "#veryfront/compat/path/index.ts";
import { runtime } from "#veryfront/platform/adapters/detect.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { CSSOptimizerService } from "./optimizer-service.ts";
import {
  createTestCSSOptimizationEngine,
  createTestCSSSourceMap,
} from "../../../../tests/_helpers/css-optimization-engine.ts";

const optimizationEngine = createTestCSSOptimizationEngine((request) => {
  if (request.css.includes("@media (")) {
    throw new TypeError("invalid CSS");
  }
  const css = request.minify
    ? request.css
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\s+/g, " ")
      .replace(/\s*([{}:;,])\s*/g, "$1")
      .replace(/;}/g, "}")
      .trim()
    : request.css;
  return {
    css,
    ...(request.sourceMap ? { sourceMap: createTestCSSSourceMap(request.sourcePath) } : {}),
  };
});

async function withProject(
  callback: (projectDir: string) => Promise<void>,
): Promise<void> {
  const projectDir = await Deno.makeTempDir();
  try {
    await Deno.mkdir(join(projectDir, "styles"), { recursive: true });
    await callback(projectDir);
  } finally {
    await Deno.remove(projectDir, { recursive: true });
  }
}

async function createService(
  projectDir: string,
  options: ConstructorParameters<typeof CSSOptimizerService>[2] = {},
  dependencies: ConstructorParameters<typeof CSSOptimizerService>[3] = {},
): Promise<CSSOptimizerService> {
  return new CSSOptimizerService(
    await runtime.get(),
    projectDir,
    {
      inputDir: "styles",
      outputDir: ".veryfront/css",
      ...options,
    },
    { optimizationEngine, ...dependencies },
  );
}

describe("build/asset-pipeline/css-optimizer/optimizer-service", () => {
  it("publishes nested outputs, source maps, and a complete manifest", async () => {
    await withProject(async (projectDir) => {
      await Deno.mkdir(join(projectDir, "styles/nested"));
      await Deno.writeTextFile(
        join(projectDir, "styles/nested/main.css"),
        "/* comment */ .button { user-select: none; color: red; }",
      );
      const service = await createService(projectDir, { sourceMap: true });

      const bundles = await service.optimize();
      const bundle = bundles.get("nested/main.css")!;
      assertEquals(bundle.content.includes("/* comment */"), false);
      assertEquals(bundle.content.includes("sourceMappingURL=main.min.css.map"), true);
      assertEquals(bundle.outputFile, ".veryfront/css/nested/main.min.css");
      assertEquals(
        await Deno.readTextFile(
          join(projectDir, ".veryfront/css/nested/main.min.css"),
        ),
        bundle.content,
      );
      assertEquals(
        JSON.parse(
          await Deno.readTextFile(
            join(projectDir, ".veryfront/css/css-manifest.json"),
          ),
        )["nested/main.css"].content,
        bundle.content,
      );
      assertEquals(service.getStats().totalFiles, 1);
    });
  });

  it("replaces stale output only after every CSS file succeeds", async () => {
    await withProject(async (projectDir) => {
      await Deno.writeTextFile(
        join(projectDir, "styles/valid.css"),
        ".valid { color: green; }",
      );
      await Deno.writeTextFile(
        join(projectDir, "styles/invalid.css"),
        "@media ( { .broken { color: red; }",
      );
      const outputDir = join(projectDir, ".veryfront/css");
      await Deno.mkdir(outputDir, { recursive: true });
      await Deno.writeTextFile(join(outputDir, "sentinel.txt"), "known good");
      const service = await createService(projectDir);

      await assertRejects(() => service.optimize());
      assertEquals(
        await Deno.readTextFile(join(outputDir, "sentinel.txt")),
        "known good",
      );
      assertEquals(service.getStats().totalFiles, 0);

      const parentEntries = [];
      for await (const entry of Deno.readDir(join(projectDir, ".veryfront"))) {
        parentEntries.push(entry.name);
      }
      assertEquals(
        parentEntries.some((name) =>
          name.includes(".css.veryfront-stage-") ||
          name.includes(".css.veryfront-build.lock")
        ),
        false,
      );
    });
  });

  it("removes stale output after a successful publication", async () => {
    await withProject(async (projectDir) => {
      await Deno.writeTextFile(
        join(projectDir, "styles/main.css"),
        ".main { color: red; }",
      );
      const outputDir = join(projectDir, ".veryfront/css");
      await Deno.mkdir(outputDir, { recursive: true });
      await Deno.writeTextFile(join(outputDir, "stale.css"), "stale");

      await (await createService(projectDir)).optimize();
      await assertRejects(
        () => Deno.readTextFile(join(outputDir, "stale.css")),
        Deno.errors.NotFound,
      );
    });
  });

  it("fails closed on empty input and missing compiler dependencies", async () => {
    await withProject(async (projectDir) => {
      const emptyService = await createService(projectDir);
      await assertRejects(
        () => emptyService.optimize(),
        TypeError,
        "found no .css files",
      );

      await Deno.writeTextFile(
        join(projectDir, "styles/main.css"),
        ".main { color: red; }",
      );
      const missingDependency = createTestCSSOptimizationEngine(() => {
        throw new Error("compiler unavailable");
      });
      const dependencyService = await createService(
        projectDir,
        {},
        { optimizationEngine: missingDependency },
      );
      await assertRejects(
        () => dependencyService.optimize(),
        Error,
        "compiler unavailable",
      );
    });
  });

  it("runs parser-backed purge before minification", async () => {
    await withProject(async (projectDir) => {
      await Deno.mkdir(join(projectDir, "app"));
      await Deno.writeTextFile(
        join(projectDir, "app/page.tsx"),
        '<div className="used">content</div>',
      );
      await Deno.writeTextFile(
        join(projectDir, "styles/main.css"),
        ".used { color: green; } .unused { color: red; }",
      );
      const service = await createService(projectDir, {
        purge: true,
        purgeContent: ["app/**/*.tsx"],
      });

      const content = (await service.optimize()).get("main.css")!.content;
      assertEquals(content.includes(".used"), true);
      assertEquals(content.includes(".unused"), false);
    });
  });

  it("rejects unsafe configurations and unsupported batch combinations", async () => {
    await withProject(async (projectDir) => {
      const adapter = await runtime.get();
      assertThrows(
        () =>
          new CSSOptimizerService(adapter, projectDir, {
            inputDir: "styles",
            outputDir: "styles/output",
          }),
        TypeError,
        "must not overlap",
      );
      assertThrows(
        () =>
          new CSSOptimizerService(adapter, projectDir, {
            inputDir: "../outside",
          }),
        TypeError,
        "inside the project",
      );
      assertThrows(
        () =>
          new CSSOptimizerService(adapter, projectDir, {
            projectDir: "relative",
          }),
        TypeError,
        "must be absolute",
      );
      assertThrows(
        () =>
          new CSSOptimizerService(adapter, projectDir, {
            inputFiles: [".veryfront/css/generated.css"],
            outputDir: ".veryfront/css",
          }),
        TypeError,
        "outside the output directory",
      );

      const critical = await createService(projectDir, { criticalCSS: true });
      await assertRejects(
        () => critical.optimize(),
        TypeError,
        "call extractCriticalCSS",
      );
      const unmappable = await createService(projectDir, {
        purge: true,
        sourceMap: true,
      });
      await assertRejects(
        () => unmappable.optimize(),
        TypeError,
        "cannot be composed",
      );
    });
  });

  it("coalesces concurrent runs and does not expose mutable result state", async () => {
    await withProject(async (projectDir) => {
      await Deno.writeTextFile(
        join(projectDir, "styles/main.css"),
        ".main { color: red; }",
      );
      const service = await createService(projectDir);
      const [first, second] = await Promise.all([
        service.optimize(),
        service.optimize(),
      ]);
      first.get("main.css")!.content = "mutated";
      assertEquals(second.get("main.css")!.content.includes(".main"), true);
      assertEquals(
        service.getCacheManager().getBundle("main.css")!.content.includes(
          ".main",
        ),
        true,
      );
    });
  });
});

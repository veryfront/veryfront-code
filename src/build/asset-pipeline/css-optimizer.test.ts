import "#veryfront/schemas/_test-setup.ts";
import { join } from "#veryfront/compat/path/index.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createTestCSSPurgingEngine,
  withTestCSSPurgingEngine,
} from "../../../tests/_helpers/css-purging-engine.ts";
import { CSSOptimizer, loadCSSManifest, optimizeCSS } from "./css-optimizer/index.ts";
import { LightningCSSOptimizationEngine } from "../../../extensions/ext-css-lightning/src/index.ts";

const optimizationEngine = new LightningCSSOptimizationEngine();
const legacyOptimizationEngine = new LightningCSSOptimizationEngine({
  browserQueries: ["ie 11"],
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

describe("build/asset-pipeline/CSSOptimizer", () => {
  it("rejects malformed facade options synchronously", () => {
    assertThrows(
      () => new CSSOptimizer(null as unknown as Record<string, never>),
      TypeError,
      "must be an object",
    );
    assertThrows(
      () =>
        new CSSOptimizer({
          inputFiles: "styles/main.css" as unknown as string[],
        }),
      TypeError,
      "inputFiles must be an array",
    );
  });

  it("initializes the required compiler and honors disabled mode", async () => {
    await withProject(async (projectDir) => {
      assertEquals(
        await new CSSOptimizer(
          { projectDir, enabled: true },
          undefined,
          { optimizationEngine },
        ).init(),
        true,
      );
      assertEquals(
        (await new CSSOptimizer(
          { projectDir, enabled: false },
          undefined,
          { optimizationEngine },
        ).optimize()).size,
        0,
      );
    });
  });

  it("minifies valid CSS and reports exact byte statistics", async () => {
    await withProject(async (projectDir) => {
      const input = "/* comment */ .button { color: red; padding: 1rem; }";
      await Deno.writeTextFile(join(projectDir, "styles/main.css"), input);
      const optimizer = new CSSOptimizer(
        {
          projectDir,
          inputDir: "styles",
          outputDir: ".veryfront/css",
        },
        undefined,
        { optimizationEngine },
      );

      const bundle = (await optimizer.optimize()).get("main.css")!;
      assertEquals(bundle.content, ".button{color:red;padding:1rem}");
      assertEquals(bundle.size, new TextEncoder().encode(input).length);
      assertEquals(
        bundle.minifiedSize,
        new TextEncoder().encode(bundle.content).length,
      );
      assertEquals((await optimizer.getStats()).totalFiles, 1);
    });
  });

  it("takes browser compatibility from the explicit provider", async () => {
    await withProject(async (projectDir) => {
      await Deno.writeTextFile(
        join(projectDir, "styles/main.css"),
        ".field { user-select: none; appearance: none; }",
      );
      const prefixed = await optimizeCSS({
        projectDir,
        inputDir: "styles",
        outputDir: ".veryfront/prefixed",
      }, { optimizationEngine: legacyOptimizationEngine });

      assertEquals(
        prefixed.get("main.css")!.content.includes("-ms-user-select"),
        true,
      );
      assertThrows(
        () =>
          new CSSOptimizer({
            projectDir,
            browsers: ["ie 11"],
          }),
        TypeError,
        "moved to the optimization extension",
      );
    });
  });

  it("writes usable source-map links and rejects malformed CSS", async () => {
    await withProject(async (projectDir) => {
      await Deno.writeTextFile(
        join(projectDir, "styles/main.css"),
        ".main { color: red; }",
      );
      const optimizer = new CSSOptimizer(
        {
          projectDir,
          inputDir: "styles",
          outputDir: ".veryfront/css",
          sourceMap: true,
        },
        undefined,
        { optimizationEngine },
      );
      const bundle = (await optimizer.optimize()).get("main.css")!;
      assertEquals(
        bundle.content.includes("sourceMappingURL=main.min.css.map"),
        true,
      );
      assertEquals(JSON.parse(bundle.sourceMap!).version, 3);

      await Deno.writeTextFile(
        join(projectDir, "styles/main.css"),
        "@media ( { .broken { color: red; }",
      );
      await assertRejects(() => optimizer.optimize());
      assertEquals(
        await Deno.readTextFile(join(projectDir, ".veryfront/css/main.min.css")),
        bundle.content,
      );
    });
  });

  it("extracts critical and remaining CSS through the configured provider", async () => {
    await withProject(async (projectDir) => {
      const cssPath = join(projectDir, "styles/main.css");
      await Deno.writeTextFile(
        cssPath,
        ".header { color: red; } " +
          ".footer { color: blue; } " +
          "@media (min-width: 40rem) { .header { display: flex; } .aside { display: block; } }",
      );
      const result = await withTestCSSPurgingEngine(
        createTestCSSPurgingEngine(() =>
          Promise.resolve({
            css: ".header { color: red; } " +
              "@media (min-width: 40rem) { .header { display: flex; } }",
            rejectedCSS: ".footer { color: blue; } " +
              "@media (min-width: 40rem) { .aside { display: block; } }",
          })
        ),
        () =>
          new CSSOptimizer(
            { projectDir, minify: true },
            undefined,
            { optimizationEngine },
          ).extractCriticalCSS(
            cssPath,
            '<header class="header">Title</header>',
          ),
      );

      assertEquals(result.critical.includes(".header"), true);
      assertEquals(result.critical.includes(".footer"), false);
      assertEquals(result.remaining.includes(".footer"), true);
      assertEquals(result.remaining.includes(".aside"), true);
      assertEquals(
        result.criticalSize,
        new TextEncoder().encode(result.critical).length,
      );
    });
  });

  it("supports explicit project-contained input files", async () => {
    await withProject(async (projectDir) => {
      await Deno.writeTextFile(
        join(projectDir, "standalone.css"),
        ".standalone { color: purple; }",
      );
      const bundles = await optimizeCSS({
        projectDir,
        inputDir: "styles",
        inputFiles: ["standalone.css"],
        outputDir: ".veryfront/css",
      }, { optimizationEngine });

      assertEquals(bundles.has("standalone.css"), true);
      assertEquals(
        await Deno.readTextFile(
          join(projectDir, ".veryfront/css/standalone.min.css"),
        ),
        ".standalone{color:purple}",
      );
    });
  });

  it("loads the published complete manifest", async () => {
    await withProject(async (projectDir) => {
      await Deno.writeTextFile(
        join(projectDir, "styles/main.css"),
        ".main { color: red; }",
      );
      await optimizeCSS({
        projectDir,
        inputDir: "styles",
        outputDir: ".veryfront/css",
      }, { optimizationEngine });

      const manifest = await loadCSSManifest(
        join(projectDir, ".veryfront/css"),
      );
      assertEquals(manifest.get("main.css")?.content, ".main{color:red}");
      assertEquals(
        manifest.get("main.css")?.outputFile,
        ".veryfront/css/main.min.css",
      );
    });
  });
});

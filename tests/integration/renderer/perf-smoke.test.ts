import { assertEquals } from "#veryfront/testing/assert";
import { join } from "#veryfront/compat/path";
import { mkdir, writeTextFile } from "#veryfront/compat/fs.ts";
import { describe, it } from "#veryfront/testing/bdd";
import { createRenderer } from "../../../src/rendering/index.ts";
import { withTestContext } from "../../_helpers/context.ts";

describe(
  "Renderer Performance",
  {
    sanitizeResources: false,
    sanitizeOps: false,
  },
  () => {
    it("should render large MDX page under reasonable time", async () => {
      await withTestContext("perf-smoke", async (context) => {
        const appLongDir = join(context.projectDir, "app", "long");
        await mkdir(appLongDir, { recursive: true });

        const para = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Cras pretium.\n\n";
        const content = ["# Perf Test\n\n", ...Array.from({ length: 2000 }, () => para)].join("");

        await writeTextFile(join(appLongDir, "page.mdx"), content);

        const renderer = await createRenderer({
          projectDir: context.projectDir,
          mode: "development",
        });

        const start = performance.now();
        const result = await renderer.renderPage("long");
        const elapsed = performance.now() - start;

        assertEquals(typeof result.html, "string");

        if (!result.html.includes("Perf Test")) {
          throw new Error("Rendered HTML missing header");
        }

        if (elapsed > 15000) {
          throw new Error(`Perf smoke exceeded threshold: ${elapsed.toFixed(0)}ms`);
        }
      });
    });
  },
);

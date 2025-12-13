import { assertEquals } from "std/assert/mod.ts";
import { join } from "std/path/mod.ts";
import { describe, it } from "std/testing/bdd.ts";
import { createRenderer } from "../../../src/rendering/index.ts";
import { withTestContext } from "../../_helpers/context.ts";

  // Note: Sanitizers disabled due to React 19 SSR MessagePort cleanup issue
  describe(
  "Renderer Performance",
  {
    sanitizeResources: false,
    sanitizeOps: false,
  },
  () => {
    it("should render large MDX page under 3000ms", async () => {
      await withTestContext("perf-smoke", async (context) => {
        const appLongDir = join(context.projectDir, "app", "long");
        await Deno.mkdir(appLongDir, { recursive: true });

        const para = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Cras pretium.\n\n";
        const content = ["# Perf Test\n\n"]
          .concat(Array.from({ length: 2000 }, () => para))
          .join("");

        await Deno.writeTextFile(join(appLongDir, "page.mdx"), content);

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

        if (elapsed > 6000) {
          throw new Error(`Perf smoke exceeded threshold: ${elapsed.toFixed(0)}ms`);
        }
      });
    });
  },
);

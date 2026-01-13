import { assertEquals } from "jsr:@std/assert@1";
import { join } from "jsr:@std/path@1";
import { denoAdapter } from "@veryfront/platform/adapters/runtime/deno/index.ts";
import { clearSSRModuleCache, SSRModuleLoader } from "./index.ts";

Deno.test({
  name: "SSRModuleLoader isolates cache by projectId",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    clearSSRModuleCache();

    const projectDir = await Deno.makeTempDir({ prefix: "vf-ssr-loader-" });
    const filePath = join(projectDir, "components", "Widget.tsx");

    try {
      await Deno.mkdir(join(projectDir, "components"), { recursive: true });

      const sourceA = "export default function WidgetA() { return null; }";
      const sourceB = "export default function WidgetB() { return null; }";

      await Deno.writeTextFile(filePath, sourceA);

      const loaderA = new SSRModuleLoader({
        projectDir,
        projectId: "project-a",
        adapter: denoAdapter,
        dev: true,
      });

      const loaderB = new SSRModuleLoader({
        projectDir,
        projectId: "project-b",
        adapter: denoAdapter,
        dev: true,
      });

      const componentA = await loaderA.loadModule(filePath, sourceA);
      const componentB = await loaderB.loadModule(filePath, sourceB);

      assertEquals(componentA.name, "WidgetA");
      assertEquals(componentB.name, "WidgetB");
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  },
});

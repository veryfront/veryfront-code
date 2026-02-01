import { assertEquals } from "#veryfront/testing/assert";
import { join } from "#veryfront/compat/path";
import { writeTextFile } from "#veryfront/compat/fs.ts";
import { describe, it } from "#veryfront/testing/bdd";
import { getAdapter } from "#veryfront/platform/adapters/detect.ts";
import { loadComponentFromSource } from "../../../src/modules/react-loader/index.ts";
import { withTestContext } from "../../_helpers/context.ts";

describe(
  "Tenant module isolation",
  { sanitizeResources: false, sanitizeOps: false },
  () => {
    it("isolates module temp files per projectId", async () => {
      const adapter = await getAdapter();

      await withTestContext("tenant-modules-a", async (contextA) => {
        await withTestContext("tenant-modules-b", async (contextB) => {
          const filePathA = join(contextA.projectDir, "components", "Widget.tsx");
          const filePathB = join(contextB.projectDir, "components", "Widget.tsx");

          const sourceA = "export default function WidgetA() { return null; }";
          const sourceB = "export default function WidgetB() { return null; }";

          await Promise.all([
            writeTextFile(filePathA, sourceA),
            writeTextFile(filePathB, sourceB),
          ]);

          const componentA = await loadComponentFromSource(
            sourceA,
            filePathA,
            contextA.projectDir,
            adapter,
            { dev: true, ssr: false, projectId: "project-a" },
          );

          const componentB = await loadComponentFromSource(
            sourceB,
            filePathB,
            contextB.projectDir,
            adapter,
            { dev: true, ssr: false, projectId: "project-b" },
          );

          const componentAAgain = await loadComponentFromSource(
            sourceA,
            filePathA,
            contextA.projectDir,
            adapter,
            { dev: true, ssr: false, projectId: "project-a" },
          );

          assertEquals(componentA.name, "WidgetA");
          assertEquals(componentB.name, "WidgetB");
          assertEquals(componentAAgain.name, "WidgetA");
        });
      });
    });
  },
);

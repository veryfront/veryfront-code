import { assert, assertStringIncludes } from "@veryfront/testing/assert";
import { join } from "@veryfront/compat/path";
import { writeTextFile } from "@veryfront/compat/fs.ts";
import { describe, it } from "@veryfront/testing/bdd";
import { createRenderer } from "../../../src/rendering/index.ts";
import { cleanupBundler } from "../../../src/rendering/cleanup.ts";
import { withTestContext } from "../../_helpers/context.ts";

describe(
  "Tenant MDX cache isolation",
  { sanitizeResources: false, sanitizeOps: false },
  () => {
    it("isolates MDX module caches per projectId", async () => {
      await withTestContext("tenant-mdx-a", async (contextA) => {
        await withTestContext("tenant-mdx-b", async (contextB) => {
          await writeTextFile(
            join(contextA.projectDir, "pages", "index.mdx"),
            `# Project A

Content from tenant A`,
          );
          await writeTextFile(
            join(contextB.projectDir, "pages", "index.mdx"),
            `# Project B

Content from tenant B`,
          );

          const rendererA = await createRenderer({
            projectDir: contextA.projectDir,
            mode: "development",
            projectId: "project-a",
          });

          const rendererB = await createRenderer({
            projectDir: contextB.projectDir,
            mode: "development",
            projectId: "project-b",
          });

          const resultA = await rendererA.renderPage("index", { projectId: "project-a" });
          assertStringIncludes(resultA.html, "Project A");
          assertStringIncludes(resultA.html, "Content from tenant A");
          assert(!resultA.html.includes("Project B"));

          const resultB = await rendererB.renderPage("index", { projectId: "project-b" });
          assertStringIncludes(resultB.html, "Project B");
          assertStringIncludes(resultB.html, "Content from tenant B");
          assert(!resultB.html.includes("Project A"));

          const resultAAgain = await rendererA.renderPage("index", { projectId: "project-a" });
          assertStringIncludes(resultAAgain.html, "Project A");

          if (rendererA && typeof rendererA.clearAllState === "function") {
            await rendererA.clearAllState();
          }
          if (rendererB && typeof rendererB.clearAllState === "function") {
            await rendererB.clearAllState();
          }

          await cleanupBundler();
        });
      });
    });
  },
);

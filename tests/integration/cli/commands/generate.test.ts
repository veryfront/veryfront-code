import { assert } from "@veryfront/testing/assert";
import { join } from "@veryfront/compat/path";
import { describe, it } from "@veryfront/testing/bdd";
import { exists, remove, writeTextFile } from "@veryfront/compat/fs.ts";
import { generateCommand } from "../../../../src/cli/commands/generate.ts";
import { type TestContext, withTestContext } from "../../../_helpers/context.ts";

describe("CLI generate command", () => {
  it("creates files", async () => {
    await withTestContext("generate-files", async (context: TestContext) => {
      await generateCommand(context.projectDir, "page", "docs/intro");
      await generateCommand(context.projectDir, "layout", "main");
      await generateCommand(context.projectDir, "api", "users/[id]");

      assert(await exists(join(context.projectDir, "pages", "docs", "intro.mdx")));
      assert(await exists(join(context.projectDir, "layouts", "main.mdx")));
      // file might be nested; quick glob check by stat tries both
      assert(
        (await exists(join(context.projectDir, "pages", "api", "users", "[id].ts"))) ||
          (await exists(join(context.projectDir, "pages", "api", "users", "id.ts"))),
      );
    });
  });

  it("respects preferredRouter: app-router", async () => {
    await withTestContext("generate-app-router", async (context: TestContext) => {
      // Remove default config and create one with preferred router
      await remove(join(context.projectDir, "veryfront.config.js"));
      await writeTextFile(
        join(context.projectDir, "veryfront.config.js"),
        `export default { generate: { preferredRouter: "app-router" } };\n`,
      );

      await generateCommand(context.projectDir, "page", "docs/intro");
      await generateCommand(context.projectDir, "api", "users/[id]");
      await generateCommand(context.projectDir, "layout", "nested");

      assert(await exists(join(context.projectDir, "app", "docs", "intro", "page.tsx")));
      assert(await exists(join(context.projectDir, "app", "users", "[id]", "route.ts")));
      assert(await exists(join(context.projectDir, "app", "nested", "layout.tsx")));
    });
  });

  it("page MyPage creates correct path for both routers", async () => {
    // App Router
    await withTestContext("generate-mypage-app", async (context: TestContext) => {
      // Remove default config and create one with app router preference
      await remove(join(context.projectDir, "veryfront.config.js"));
      await writeTextFile(
        join(context.projectDir, "veryfront.config.js"),
        `export default { generate: { preferredRouter: "app-router" } };\n`,
      );
      await generateCommand(context.projectDir, "page", "MyPage");
      assert(await exists(join(context.projectDir, "app", "MyPage", "page.tsx")));
    });

    // Pages Router
    await withTestContext("generate-mypage-pages", async (context: TestContext) => {
      // Remove default config and create one with pages router preference
      await remove(join(context.projectDir, "veryfront.config.js"));
      await writeTextFile(
        join(context.projectDir, "veryfront.config.js"),
        `export default { generate: { preferredRouter: "pages-router" } };\n`,
      );
      await generateCommand(context.projectDir, "page", "MyPage");
      assert(await exists(join(context.projectDir, "pages", "MyPage.mdx")));
    });
  });
});

import { assert } from "#veryfront/testing/assert";
import { join } from "#veryfront/compat/path";
import { describe, it } from "#veryfront/testing/bdd";
import { exists, remove, writeTextFile } from "#veryfront/compat/fs.ts";
import { generateCommand } from "../../../../src/cli/commands/generate/index.ts";
import { type TestContext, withTestContext } from "../../../_helpers/context.ts";

async function setPreferredRouter(context: TestContext, preferredRouter: "app-router" | "pages-router"): Promise<void> {
  const configPath = join(context.projectDir, "veryfront.config.js");
  await remove(configPath);
  await writeTextFile(
    configPath,
    `export default { generate: { preferredRouter: "${preferredRouter}" } };\n`,
  );
}

describe("CLI generate command", () => {
  it("creates files", async () => {
    await withTestContext("generate-files", async (context: TestContext) => {
      await generateCommand(context.projectDir, "page", "docs/intro");
      await generateCommand(context.projectDir, "layout", "main");
      await generateCommand(context.projectDir, "api", "users/[id]");

      assert(await exists(join(context.projectDir, "pages", "docs", "intro.mdx")));
      assert(await exists(join(context.projectDir, "layouts", "main.mdx")));
      assert(
        (await exists(join(context.projectDir, "pages", "api", "users", "[id].ts"))) ||
          (await exists(join(context.projectDir, "pages", "api", "users", "id.ts"))),
      );
    });
  });

  it("respects preferredRouter: app-router", async () => {
    await withTestContext("generate-app-router", async (context: TestContext) => {
      await setPreferredRouter(context, "app-router");

      await generateCommand(context.projectDir, "page", "docs/intro");
      await generateCommand(context.projectDir, "api", "users/[id]");
      await generateCommand(context.projectDir, "layout", "nested");

      assert(await exists(join(context.projectDir, "app", "docs", "intro", "page.tsx")));
      assert(await exists(join(context.projectDir, "app", "users", "[id]", "route.ts")));
      assert(await exists(join(context.projectDir, "app", "nested", "layout.tsx")));
    });
  });

  it("page MyPage creates correct path for both routers", async () => {
    await withTestContext("generate-mypage-app", async (context: TestContext) => {
      await setPreferredRouter(context, "app-router");
      await generateCommand(context.projectDir, "page", "MyPage");
      assert(await exists(join(context.projectDir, "app", "MyPage", "page.tsx")));
    });

    await withTestContext("generate-mypage-pages", async (context: TestContext) => {
      await setPreferredRouter(context, "pages-router");
      await generateCommand(context.projectDir, "page", "MyPage");
      assert(await exists(join(context.projectDir, "pages", "MyPage.mdx")));
    });
  });
});

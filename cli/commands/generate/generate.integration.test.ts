import "#veryfront/schemas/_test-setup.ts";
import { assert } from "#veryfront/testing/assert";
import { join } from "#veryfront/compat/path";
import { describe, it } from "#veryfront/testing/bdd";
import { exists, remove, writeTextFile } from "#veryfront/compat/fs.ts";
import { generateCommand } from "./index.ts";
import { type TestContext, withTestContext } from "../../../tests/_helpers/context.ts";

async function setPreferredRouter(
  context: TestContext,
  preferredRouter: "app-router" | "pages-router",
): Promise<void> {
  const configPath = join(context.projectDir, "veryfront.config.js");
  await remove(configPath);
  await writeTextFile(
    configPath,
    `export default { generate: { preferredRouter: "${preferredRouter}" } };\n`,
  );
}

async function setRouter(
  context: TestContext,
  router: "app" | "pages",
): Promise<void> {
  const configPath = join(context.projectDir, "veryfront.config.js");
  await remove(configPath);
  await writeTextFile(configPath, `export default { router: "${router}" };\n`);
}

describe("CLI generate command", () => {
  it("creates app-router files by default", async () => {
    await withTestContext("generate-files", async (context: TestContext) => {
      await generateCommand(context.projectDir, "page", "docs/intro");
      await generateCommand(context.projectDir, "layout", "main");
      await generateCommand(context.projectDir, "api", "users/[id]");

      assert(await exists(join(context.projectDir, "app", "docs", "intro", "page.tsx")));
      assert(await exists(join(context.projectDir, "app", "main", "layout.tsx")));
      assert(await exists(join(context.projectDir, "app", "users", "[id]", "route.ts")));
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

  it("respects router: pages", async () => {
    await withTestContext("generate-pages-router", async (context: TestContext) => {
      await setRouter(context, "pages");

      await generateCommand(context.projectDir, "page", "docs/intro");
      await generateCommand(context.projectDir, "api", "users/[id]");

      assert(await exists(join(context.projectDir, "pages", "docs", "intro.mdx")));
      assert(await exists(join(context.projectDir, "pages", "api", "users", "[id].ts")));
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

  it("creates shared project primitive files", async () => {
    await withTestContext("generate-primitives", async (context: TestContext) => {
      await generateCommand(context.projectDir, "component", "user-card");
      await generateCommand(context.projectDir, "tool", "search-docs");
      await generateCommand(context.projectDir, "agent", "researcher");
      await generateCommand(context.projectDir, "prompt", "summarize-report");
      await generateCommand(context.projectDir, "workflow", "content-pipeline");
      await generateCommand(context.projectDir, "task", "sync-data");
      await generateCommand(context.projectDir, "resource", "docs");
      await generateCommand(context.projectDir, "skill", "code-review");

      assert(await exists(join(context.projectDir, "components", "UserCard.tsx")));
      assert(await exists(join(context.projectDir, "tools", "search-docs.ts")));
      assert(await exists(join(context.projectDir, "agents", "researcher.ts")));
      assert(await exists(join(context.projectDir, "prompts", "summarize-report.ts")));
      assert(await exists(join(context.projectDir, "workflows", "content-pipeline.ts")));
      assert(await exists(join(context.projectDir, "tasks", "sync-data.ts")));
      assert(await exists(join(context.projectDir, "resources", "docs.ts")));
      assert(await exists(join(context.projectDir, "skills", "code-review", "SKILL.md")));
    });
  });
});

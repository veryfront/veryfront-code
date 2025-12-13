import { assert } from "std/assert/assert.ts";
import { join } from "std/path/mod.ts";
import { describe, it } from "std/testing/bdd.ts";
import { generateCommand } from "../../../../src/cli/commands/generate.ts";
import { type TestContext, withTestContext } from "../../../_helpers/context.ts";

async function exists(p: string) {
  try {
    await Deno.stat(p);
    return true;
  } catch {
    return false;
  }
}

describe(
  "CLI generate command",
  
  () => {
    it("creates files", async () => {
      await withTestContext("generate-files", async (context: TestContext) => {
        await generateCommand(context.projectDir, "page", "docs/intro");
        await generateCommand(context.projectDir, "layout", "main");
        await generateCommand(context.projectDir, "provider", "theme");
        await generateCommand(context.projectDir, "api", "users/[id]");

        assert(await exists(join(context.projectDir, "pages", "docs", "intro.mdx")));
        assert(await exists(join(context.projectDir, "layouts", "main.mdx")));
        assert(await exists(join(context.projectDir, "providers", "theme.mdx")));
        assert(
          (await exists(join(context.projectDir, "pages", "api", "users", "[id].ts"))) ||
            (await exists(join(context.projectDir, "pages", "api", "users", "id.ts"))),
        );
      });
    });

    it("respects preferredRouter: app-router", async () => {
      await withTestContext("generate-app-router", async (context: TestContext) => {
        await Deno.remove(join(context.projectDir, "veryfront.config.js"));
        await Deno.writeTextFile(
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
      await withTestContext("generate-mypage-app", async (context: TestContext) => {
        await Deno.remove(join(context.projectDir, "veryfront.config.js"));
        await Deno.writeTextFile(
          join(context.projectDir, "veryfront.config.js"),
          `export default { generate: { preferredRouter: "app-router" } };\n`,
        );
        await generateCommand(context.projectDir, "page", "MyPage");
        assert(await exists(join(context.projectDir, "app", "MyPage", "page.tsx")));
      });

      await withTestContext("generate-mypage-pages", async (context: TestContext) => {
        await Deno.remove(join(context.projectDir, "veryfront.config.js"));
        await Deno.writeTextFile(
          join(context.projectDir, "veryfront.config.js"),
          `export default { generate: { preferredRouter: "pages-router" } };\n`,
        );
        await generateCommand(context.projectDir, "page", "MyPage");
        assert(await exists(join(context.projectDir, "pages", "MyPage.mdx")));
      });
    });
  },
);

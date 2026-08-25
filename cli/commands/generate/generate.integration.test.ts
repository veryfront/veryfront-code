import "#veryfront/schemas/_test-setup.ts";
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert";
import { join } from "#veryfront/compat/path";
import { describe, it } from "#veryfront/testing/bdd";
import { exists, makeTempDir, remove, writeTextFile } from "#veryfront/compat/fs.ts";
import { generateCommand } from "./index.ts";
import { type TestContext, withTestContext } from "../../../tests/_helpers/context.ts";
import {
  __registerLogRecordEmitter,
  __resetLoggerConfigForTests,
  __resetLogRecordEmitterForTests,
  type LogEntry,
} from "#veryfront/utils/logger/logger.ts";

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
      assert(await exists(join(context.projectDir, "app", "api", "users", "[id]", "route.ts")));
    });
  });

  it("generates auth files without modifying existing application files", async () => {
    await withTestContext("generate-auth-existing-app", async (context: TestContext) => {
      const configPath = join(context.projectDir, "veryfront.config.ts");
      const envPath = join(context.projectDir, ".env");
      const routePath = join(context.projectDir, "app", "api", "health", "route.ts");
      const middlewarePath = join(context.projectDir, "middleware.ts");
      await Deno.mkdir(join(context.projectDir, "app", "api", "health"), { recursive: true });
      await writeTextFile(
        configPath,
        'import { defineConfig } from "veryfront";\nexport default defineConfig(() => ({ router: "app" }));\n',
      );
      await writeTextFile(envPath, "EXISTING=value\n");
      await writeTextFile(routePath, "export const GET = () => Response.json({ ok: true });\n");
      await writeTextFile(
        middlewarePath,
        "export function middleware(req: Request) { return req; }\n",
      );

      const before = await Promise.all([
        Deno.readTextFile(configPath),
        Deno.readTextFile(envPath),
        Deno.readTextFile(routePath),
        Deno.readTextFile(middlewarePath),
      ]);

      await generateCommand(context.projectDir, "auth", "authelia");

      assert(await exists(join(context.projectDir, "AUTH_SETUP.md")));
      assert(await exists(join(context.projectDir, "AUTH_PROVIDER_SETUP.md")));
      assert(await exists(join(context.projectDir, ".env.auth.example")));
      assert(await exists(join(context.projectDir, "veryfront.auth.config.example.ts")));
      assert(await exists(join(context.projectDir, "authelia.client.example.yml")));
      assertEquals(await exists(join(context.projectDir, "app", "api", "auth", "route.ts")), false);
      assertEquals(
        await exists(join(context.projectDir, "app", "api", "auth", "callback", "route.ts")),
        false,
      );

      const after = await Promise.all([
        Deno.readTextFile(configPath),
        Deno.readTextFile(envPath),
        Deno.readTextFile(routePath),
        Deno.readTextFile(middlewarePath),
      ]);
      assertEquals(after, before);

      const setup = await Deno.readTextFile(join(context.projectDir, "AUTH_SETUP.md"));
      assertStringIncludes(setup, "/_veryfront/auth/callback");
      assertStringIncludes(setup, "No sticky sessions");
      assertStringIncludes(setup, "(iss, sub)");
    });
  });

  it("rejects unknown auth presets as a usage error", async () => {
    await withTestContext("generate-auth-unknown", async (context: TestContext) => {
      const error = await assertRejects(() => generateCommand(context.projectDir, "auth", "ldap"));

      assertStringIncludes(error.message, "Unknown auth preset");
      assertStringIncludes(error.message, "authelia, oidc, microsoft-entra");
    });
  });

  it("respects preferredRouter: app-router", async () => {
    await withTestContext("generate-app-router", async (context: TestContext) => {
      await setPreferredRouter(context, "app-router");

      await generateCommand(context.projectDir, "page", "docs/intro");
      await generateCommand(context.projectDir, "api", "users/[id]");
      await generateCommand(context.projectDir, "layout", "nested");

      assert(await exists(join(context.projectDir, "app", "docs", "intro", "page.tsx")));
      assert(await exists(join(context.projectDir, "app", "api", "users", "[id]", "route.ts")));
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

  describe("outside a Veryfront project", () => {
    function captureLogs(): LogEntry[] {
      const entries: LogEntry[] = [];
      __resetLoggerConfigForTests();
      __registerLogRecordEmitter((entry) => entries.push(entry));
      return entries;
    }

    it("warns before scaffolding into a directory that is not a project", async () => {
      const bare = await makeTempDir({ prefix: "generate-not-a-project-" });
      const entries = captureLogs();
      try {
        await generateCommand(bare, "page", "about");

        const warning = entries.find((entry) =>
          entry.level === "warn" && entry.message.includes("does not look like a Veryfront project")
        );
        assert(
          warning !== undefined,
          "expected a warning that the target directory is not a Veryfront project",
        );
        // Still scaffolds — the warning informs, it does not block.
        assert(await exists(join(bare, "app", "about", "page.tsx")));
      } finally {
        __resetLogRecordEmitterForTests();
        __resetLoggerConfigForTests();
        await remove(bare, { recursive: true });
      }
    });

    it("does not leak an absolute machine path into the warning", async () => {
      // AGENTS.md forbids local absolute paths in user-facing output.
      const bare = await makeTempDir({ prefix: "generate-no-path-leak-" });
      const entries = captureLogs();
      try {
        await generateCommand(bare, "page", "about");

        const warning = entries.find((entry) =>
          entry.level === "warn" && entry.message.includes("does not look like a Veryfront project")
        );
        assert(warning !== undefined, "expected the outside-project warning");
        assert(
          !warning.message.includes(bare),
          `warning must not contain the absolute path: ${warning?.message}`,
        );
      } finally {
        __resetLogRecordEmitterForTests();
        __resetLoggerConfigForTests();
        await remove(bare, { recursive: true });
      }
    });

    it("treats a commented deno.jsonc with a veryfront import as a project", async () => {
      // Deno permits comments and trailing commas here; strict JSON parsing
      // made such a project look like no project at all.
      const dir = await makeTempDir({ prefix: "generate-denojsonc-" });
      const entries = captureLogs();
      try {
        await writeTextFile(
          join(dir, "deno.jsonc"),
          '{\n  // the framework\n  "imports": {\n    "veryfront": "npm:veryfront@^0.1.0",\n  },\n}\n',
        );
        await generateCommand(dir, "page", "about");

        const warning = entries.find((entry) =>
          entry.level === "warn" && entry.message.includes("does not look like a Veryfront project")
        );
        assert(warning === undefined, "a commented deno.jsonc must count as project evidence");
      } finally {
        __resetLogRecordEmitterForTests();
        __resetLoggerConfigForTests();
        await remove(dir, { recursive: true });
      }
    });

    it("treats a legacy veryfront.json as a project marker", async () => {
      const dir = await makeTempDir({ prefix: "generate-legacy-config-" });
      const entries = captureLogs();
      try {
        await writeTextFile(join(dir, "veryfront.json"), '{ "projectSlug": "legacy-app" }\n');
        await generateCommand(dir, "page", "about");

        const warning = entries.find((entry) =>
          entry.level === "warn" && entry.message.includes("does not look like a Veryfront project")
        );
        assert(warning === undefined, "veryfront.json is still read by the config loader");
      } finally {
        __resetLogRecordEmitterForTests();
        __resetLoggerConfigForTests();
        await remove(dir, { recursive: true });
      }
    });

    it("stays quiet inside a real project", async () => {
      await withTestContext("generate-in-project-quiet", async (context: TestContext) => {
        const entries = captureLogs();
        try {
          await generateCommand(context.projectDir, "page", "about");

          const warning = entries.find((entry) =>
            entry.level === "warn" &&
            entry.message.includes("does not look like a Veryfront project")
          );
          assert(warning === undefined, "must not warn inside a real project");
        } finally {
          __resetLogRecordEmitterForTests();
          __resetLoggerConfigForTests();
        }
      });
    });
  });
});

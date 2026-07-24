import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

import { getTemplate, templateConfigs } from "./index.ts";
import { STARTER_TEMPLATE_NAMES, type TemplateName } from "./types.ts";

const STYLED_STARTER_TEMPLATES: TemplateName[] = [
  "ai-agent",
  "docs-agent",
  "multi-agent-system",
  "agentic-workflow",
  "coding-agent",
  "saas-starter",
];

async function collectTemplateTsFiles(dir: URL): Promise<URL[]> {
  const files: URL[] = [];

  for await (const entry of Deno.readDir(dir)) {
    const child = new URL(`${entry.name}${entry.isDirectory ? "/" : ""}`, dir);

    if (entry.isDirectory) {
      files.push(...await collectTemplateTsFiles(child));
    } else if (entry.isFile && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
      files.push(child);
    }
  }

  return files;
}

describe("cli/templates", () => {
  it("keeps starter npm dependencies out of root package template files", async () => {
    const offenders: string[] = [];

    for (const templateName of STARTER_TEMPLATE_NAMES) {
      const files = await getTemplate(templateName);
      assertExists(files, `${templateName} should load from the template registry`);

      if (files.some((file) => file.path === "package.json")) {
        offenders.push(templateName);
      }
    }

    assertEquals(
      offenders,
      [],
      `Starter templates must use template config for npm dependencies, not root package.json files. Offenders: ${
        offenders.join(", ")
      }`,
    );
    assertEquals(templateConfigs["docs-agent"]?.npmDependencies?.["@kreuzberg/node"], "^4.4.2");
    assertEquals(templateConfigs["docs-agent"]?.npmDependencies?.["@kreuzberg/wasm"], "4.5.2");
    assertEquals(templateConfigs["docs-agent"]?.firstPartyExtensions, [
      "@veryfront/ext-document-kreuzberg",
    ]);
  });

  it("ships a Tailwind entry stylesheet for styled starter templates", async () => {
    for (const templateName of STYLED_STARTER_TEMPLATES) {
      const globalsPath = new URL(`./files/${templateName}/globals.css`, import.meta.url);
      const globals = await Deno.readTextFile(globalsPath);
      assertExists(globals, `${templateName} should include globals.css`);
      assertEquals(
        globals.includes('@import "tailwindcss";'),
        true,
        `${templateName} globals.css should import tailwindcss`,
      );
    }
  });

  it("imports globals.css from each styled starter root layout", async () => {
    for (const templateName of STYLED_STARTER_TEMPLATES) {
      const layoutPath = new URL(`./files/${templateName}/app/layout.tsx`, import.meta.url);
      const layout = await Deno.readTextFile(layoutPath);
      assertExists(layout, `${templateName} should include app/layout.tsx`);
      assertEquals(
        layout.includes('import "../globals.css";') ||
          layout.includes('import "./globals.css";') ||
          layout.includes('import "@/globals.css";'),
        true,
        `${templateName} layout should import globals.css`,
      );
    }
  });

  it("keeps the ai-agent calculator template lint-clean", async () => {
    const calculatorPath = new URL("./files/ai-agent/tools/calculator.ts", import.meta.url);
    const calculator = await Deno.readTextFile(calculatorPath);

    assertEquals(calculator.includes("execute: async"), false);
    assertEquals(calculator.includes("execute: ({ operation, a, b }) =>"), true);
  });

  it("uses the current app-mode chat surface in starter templates", async () => {
    const simpleStarters: Array<{ template: TemplateName; page: string; agentId: string }> = [
      { template: "ai-agent", page: "app/page.tsx", agentId: "assistant" },
      { template: "multi-agent-system", page: "app/page.tsx", agentId: "orchestrator" },
      { template: "coding-agent", page: "app/page.tsx", agentId: "coder" },
      { template: "saas-starter", page: "app/dashboard/page.tsx", agentId: "assistant" },
    ];

    for (const { template, page, agentId } of simpleStarters) {
      const pageSource = await Deno.readTextFile(
        new URL(`./files/${template}/${page}`, import.meta.url),
      );
      assertEquals(
        pageSource.includes("useChat"),
        false,
        `${template} should use app-mode Chat instead of wiring useChat manually`,
      );
      assertEquals(
        pageSource.includes(`agentId="${agentId}"`),
        true,
        `${template} should pass its generated agent id to Chat`,
      );
    }

    const featureChat = await Deno.readTextFile(
      new URL("./features/ai/files/app/chat/page.tsx", import.meta.url),
    );
    assertEquals(featureChat.includes("useChat"), false);
    assertEquals(featureChat.includes('agentId="assistant"'), true);
  });

  it("keeps docs-agent on the shared chat shell and uploads components", async () => {
    const layout = await Deno.readTextFile(
      new URL("./files/docs-agent/app/layout.tsx", import.meta.url),
    );
    const page = await Deno.readTextFile(
      new URL("./files/docs-agent/app/page.tsx", import.meta.url),
    );
    const uploadsPage = await Deno.readTextFile(
      new URL("./files/docs-agent/app/uploads/page.tsx", import.meta.url),
    );
    const agent = await Deno.readTextFile(
      new URL("./files/docs-agent/agents/rag.ts", import.meta.url),
    );

    for (
      const needle of [
        "ChatThemeScope",
        "ConversationsProvider",
        "AppShell",
        "ChatSidebar",
        "Tabs",
      ]
    ) {
      assertEquals(layout.includes(needle), true, `docs-agent layout should use ${needle}`);
    }
    assertEquals(layout.includes("<ChatSidebar.Root"), true);
    assertEquals(layout.includes("<ChatSidebar fill"), false);

    assertEquals(page.includes("useChat"), false);
    assertEquals(page.includes('agentId="rag"'), true);
    assertEquals(page.includes('uploadApi="/api/uploads"'), true);
    assertEquals(uploadsPage.includes("AttachmentsPanel"), true);
    assertEquals(uploadsPage.includes("useUploadsRegistry"), true);
    assertEquals(agent.includes("suggestions:"), true);
  });

  it("keeps docs-agent consumer TypeScript configuration clean", async () => {
    const files = await getTemplate("docs-agent");
    assertExists(files);

    const tsconfig = files.find((file) => file.path === "tsconfig.json");
    assertExists(tsconfig, "docs-agent should declare consumer TypeScript options");
    assertEquals(
      tsconfig.content.includes('"allowImportingTsExtensions": true'),
      true,
      "docs-agent should allow Deno-native .ts app route imports during consumer tsc",
    );
    assertEquals(
      tsconfig.content.includes('"noEmit": true'),
      true,
      "docs-agent should keep allowImportingTsExtensions valid for consumer tsc",
    );

    const globalTypes = files.find((file) => file.path === "globals.d.ts");
    assertExists(globalTypes, "docs-agent should declare stylesheet imports for consumer tsc");
    assertEquals(globalTypes.content.includes('declare module "*.css";'), true);

    const layout = files.find((file) => file.path === "app/layout.tsx");
    assertExists(layout);
    assertEquals(
      layout.content.includes("onValueChange={(value: string) =>"),
      true,
      "docs-agent should type the Tabs callback against published consumer declarations",
    );
  });

  it("keeps docs-agent app route modules importable by Deno", async () => {
    const routePaths = [
      "app/api/ag-ui/route.ts",
      "app/api/ingest/route.ts",
      "app/api/uploads/route.ts",
    ];

    for (const routePath of routePaths) {
      await import(new URL(`./files/docs-agent/${routePath}`, import.meta.url).href);
    }
  });

  it("integration token store fails closed instead of silently using memory in production", async () => {
    const tokenStorePath = new URL(
      "./integrations/_base/files/lib/token-store.ts",
      import.meta.url,
    );
    const tokenStore = await Deno.readTextFile(tokenStorePath);

    assertEquals(
      tokenStore.includes("createDefaultTokenStore"),
      true,
      "token-store.ts should centralize default store selection",
    );
    assertEquals(
      tokenStore.includes("In-memory token storage is not allowed in production"),
      true,
      "token-store.ts should fail closed for production memory storage",
    );
    assertEquals(
      tokenStore.includes("getDefaultTokenStore"),
      true,
      "token-store.ts should resolve the default store lazily",
    );
    assertEquals(
      tokenStore.includes("export const tokenStore: TokenStore = inMemoryStore;"),
      false,
      "token-store.ts must not export the in-memory store unconditionally",
    );
    assertEquals(
      tokenStore.includes("export const tokenStore: TokenStore = createDefaultTokenStore();"),
      false,
      "token-store.ts must not throw during module import in production",
    );
  });

  it("integration templates do not use a shared current-user token key", async () => {
    const integrationTemplates = new URL("./integrations/", import.meta.url);
    const offenders: string[] = [];

    for (const file of await collectTemplateTsFiles(integrationTemplates)) {
      const source = await Deno.readTextFile(file);
      if (source.includes('"current-user"') || source.includes("'current-user'")) {
        offenders.push(file.pathname.replace(integrationTemplates.pathname, ""));
      }
    }

    assertEquals(
      offenders,
      [],
      `Integration templates must require a real user id. Offenders: ${offenders.join(", ")}`,
    );
  });

  it("integration content tools do not impose fixed text caps", async () => {
    const checkedFiles = [
      "./integrations/github/files/tools/get-pr-diff.ts",
      "./integrations/sharepoint/files/tools/get-file.ts",
    ];
    const forbidden = [
      "50000",
      "50_000",
      "contentMaxLength",
      "maxDiffLength",
      "Content truncated",
      "diff truncated",
      "maximum content length",
    ];
    const offenders: string[] = [];

    for (const filePath of checkedFiles) {
      const source = await Deno.readTextFile(new URL(filePath, import.meta.url));
      for (const needle of forbidden) {
        if (source.includes(needle)) {
          offenders.push(`${filePath}: ${needle}`);
        }
      }
    }

    assertEquals(
      offenders,
      [],
      `Integration content tools must return full requested text by default. Offenders: ${
        offenders.join(", ")
      }`,
    );
  });

  it("base integration tools do not read legacy endUserId from tool context", async () => {
    const userIdTemplatePath = new URL(
      "./integrations/_base/files/lib/user-id.ts",
      import.meta.url,
    );
    const userIdTemplate = await Deno.readTextFile(userIdTemplatePath);

    assertEquals(
      userIdTemplate.includes("context?.endUserId"),
      false,
      "base integration tools must use app-authenticated userId rather than legacy endUserId",
    );
  });

  it("keeps generated AI rules focused on current project primitives", async () => {
    const aiRulesRoot = new URL("./ai-rules/", import.meta.url);
    const forbidden = [
      "`tasks/`",
      "`prompts/`",
      "`resources/`",
      "`integrations/`",
      "Veryfront MCP",
      "vf_bootstrap",
      "http://localhost:3002/mcp",
      "tasks, resources, prompts",
    ];
    const offenders: string[] = [];

    for await (const entry of Deno.readDir(aiRulesRoot)) {
      if (!entry.isFile || !entry.name.endsWith(".md")) continue;

      const content = await Deno.readTextFile(new URL(entry.name, aiRulesRoot));
      for (const needle of forbidden) {
        if (content.includes(needle)) {
          offenders.push(`${entry.name}: ${needle}`);
        }
      }
    }

    assertEquals(
      offenders,
      [],
      `AI-rule templates must not teach legacy project folders or MCP setup. Offenders: ${
        offenders.join(", ")
      }`,
    );
  });

  it("does not depend on the global JSX namespace in template files", async () => {
    const checkedRoots = [
      new URL("./files/", import.meta.url),
      new URL("./features/", import.meta.url),
      new URL("./integrations/", import.meta.url),
    ];
    const offenders: string[] = [];

    for (const root of checkedRoots) {
      for (const file of await collectTemplateTsFiles(root)) {
        const source = await Deno.readTextFile(file);
        if (/(^|[^.\w])JSX\./.test(source)) {
          offenders.push(file.pathname.replace(root.pathname, ""));
        }
      }
    }

    const manifest = await Deno.readTextFile(new URL("./manifest.json", import.meta.url));
    if (/(^|[^.\w])JSX\./.test(manifest)) {
      offenders.push("manifest.json");
    }

    assertEquals(
      offenders,
      [],
      `Template files must use React.JSX or inferred JSX return types for Deno checks. Offenders: ${
        offenders.join(", ")
      }`,
    );
  });
});

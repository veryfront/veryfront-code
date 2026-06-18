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

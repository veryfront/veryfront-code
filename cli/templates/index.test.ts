import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

import type { TemplateName } from "./types.ts";

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
    } else if (entry.isFile && entry.name.endsWith(".ts")) {
      files.push(child);
    }
  }

  return files;
}

describe("cli/templates", () => {
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
});

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
});

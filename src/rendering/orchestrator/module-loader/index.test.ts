import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { resolveRemainingVfModuleImports } from "./index.ts";

describe(
  "rendering/orchestrator/module-loader",
  { sanitizeOps: false, sanitizeResources: false },
  () => {
  it("resolves leftover SSR vf-module imports during the module-loader fallback pass", async () => {
    const source = `
      import { usePageContext } from "file:///_vf_modules/_veryfront/react/runtime/core.js?ssr=true";
      export default function Page() {
        return usePageContext();
      }
    `;

    const result = await resolveRemainingVfModuleImports(
      source,
      "/tmp/project/pages/index.tsx",
      "/tmp/project",
    );

    assertEquals(result.includes('file:///_vf_modules/_veryfront/react/runtime/core.js?ssr=true'), false);
    assertEquals(result.includes('file:///'), true);
  });
});

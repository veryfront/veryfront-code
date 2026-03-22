import { assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getHMRScript } from "./hmr-scripts.ts";

describe("server/handlers/dev/scripts/hmr-scripts", () => {
  it("atomically swaps the preview stylesheet when a hashed asset is ready", () => {
    const script = getHMRScript(3000);
    assertStringIncludes(script, "async function swapTailwindStylesheet(nextHref)");
    assertStringIncludes(script, "pending.setAttribute('data-vf-tailwind-pending', 'true');");
    assertStringIncludes(script, "pending.id = 'vf-tailwind-css';");
    assertStringIncludes(script, "current.remove();");
  });

  it("falls back to full reload when CSS hot-swap cannot find a stylesheet", () => {
    const script = getHMRScript(3000);
    assertStringIncludes(
      script,
      "const didRefresh = await applyStyleUpdate(update.path, update.styleHref);",
    );
    assertStringIncludes(script, "notifyStudioAndReload('css-update-no-stylesheet');");
  });

  it("threads the latest stylesheet href through batched JS updates", () => {
    const script = getHMRScript(3000);
    assertStringIncludes(script, "let pendingStyleHref = null;");
    assertStringIncludes(script, "if (typeof update.styleHref === 'string') {");
    assertStringIncludes(script, "await updateJS(paths[0], styleHref);");
  });

  it("responds to server ping keepalive messages", () => {
    const script = getHMRScript(3000);
    assertStringIncludes(script, "case 'ping':");
    assertStringIncludes(script, "type: 'pong'");
  });
});

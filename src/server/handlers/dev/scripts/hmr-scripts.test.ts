import { assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getHMRScript } from "./hmr-scripts.ts";

describe("server/handlers/dev/scripts/hmr-scripts", () => {
  it("falls back to full reload when CSS hot-swap cannot find a stylesheet", () => {
    const script = getHMRScript(3000);
    assertStringIncludes(
      script,
      "const didRefresh = refreshStylesheets(update.path) || refreshStylesheets();",
    );
    assertStringIncludes(script, "notifyStudioAndReload('css-update-no-stylesheet');");
  });

  it("responds to server ping keepalive messages", () => {
    const script = getHMRScript(3000);
    assertStringIncludes(script, "case 'ping':");
    assertStringIncludes(script, "type: 'pong'");
  });
});

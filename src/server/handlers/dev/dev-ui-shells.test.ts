import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { DASHBOARD_SHELL_HTML } from "./dashboard/html-shell.ts";
import { PROJECTS_SHELL_HTML } from "./projects/html-shell.ts";
import { DEV_UI_KIND_ATTRIBUTE } from "#veryfront/extensions/dev-ui/protocol";

describe("development UI shells", () => {
  it("delegate all implementation assets to the extension", () => {
    for (const shell of [DASHBOARD_SHELL_HTML, PROJECTS_SHELL_HTML]) {
      assertEquals(/<style(?:\s|>)/i.test(shell), false);
      assertEquals(/cdn\.tailwindcss\.com|tailwind\.config|tailwindcss/i.test(shell), false);
      assertEquals(/@import|<link[^>]+stylesheet|https?:\/\/[^"']+\.css/i.test(shell), false);
      assertEquals(/<script[^>]+type=["']importmap/i.test(shell), false);
      assertEquals(/esm\.sh|cdn\.veryfront\.com/i.test(shell), false);
    }
    assertStringIncludes(DASHBOARD_SHELL_HTML, `${DEV_UI_KIND_ATTRIBUTE}="dashboard"`);
    assertStringIncludes(PROJECTS_SHELL_HTML, `${DEV_UI_KIND_ATTRIBUTE}="projects"`);
    // Each shell must delegate to its exact extension-owned bundle endpoint,
    // not merely avoid the blacklisted asset sources above.
    assertStringIncludes(DASHBOARD_SHELL_HTML, 'src="/_dev/ui/index.js"');
    assertStringIncludes(PROJECTS_SHELL_HTML, 'src="/_projects/ui/index.js"');
  });
});

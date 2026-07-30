import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { DASHBOARD_SHELL_HTML } from "./dashboard/html-shell.ts";
import { PROJECTS_SHELL_HTML } from "./projects/html-shell.ts";
import { DEV_UI_KIND_ATTRIBUTE } from "#veryfront/extensions/dev-ui/protocol";

Deno.test("development UI shells delegate all implementation assets to the extension", () => {
  for (const shell of [DASHBOARD_SHELL_HTML, PROJECTS_SHELL_HTML]) {
    assertEquals(/<style(?:\s|>)/i.test(shell), false);
    assertEquals(/cdn\.tailwindcss\.com|tailwind\.config|tailwindcss/i.test(shell), false);
    assertEquals(/@import|<link[^>]+stylesheet|https?:\/\/[^"']+\.css/i.test(shell), false);
    assertEquals(/<script[^>]+type=["']importmap/i.test(shell), false);
    assertEquals(/esm\.sh|cdn\.veryfront\.com/i.test(shell), false);
  }
  assertStringIncludes(DASHBOARD_SHELL_HTML, `${DEV_UI_KIND_ATTRIBUTE}="dashboard"`);
  assertStringIncludes(PROJECTS_SHELL_HTML, `${DEV_UI_KIND_ATTRIBUTE}="projects"`);
});

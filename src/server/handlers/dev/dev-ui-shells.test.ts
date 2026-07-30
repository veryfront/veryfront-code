import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { DASHBOARD_SHELL_HTML } from "./dashboard/html-shell.ts";
import { PROJECTS_SHELL_HTML } from "./projects/html-shell.ts";
import { DEV_UI_STYLES, DEV_UI_STYLES_SHA256 } from "#veryfront/server/dev-ui/styles.generated.ts";

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.test("development UI shells embed deterministic dependency-free styles", async () => {
  assertEquals(await sha256(DEV_UI_STYLES), DEV_UI_STYLES_SHA256);
  assertStringIncludes(DEV_UI_STYLES, ".bg-vf-bg");
  assertStringIncludes(DEV_UI_STYLES, ".flex");

  for (const shell of [DASHBOARD_SHELL_HTML, PROJECTS_SHELL_HTML]) {
    assertStringIncludes(shell, DEV_UI_STYLES);
    assertEquals(/cdn\.tailwindcss\.com|tailwind\.config|tailwindcss/i.test(shell), false);
    assertEquals(/@import|<link[^>]+stylesheet|https?:\/\/[^"']+\.css/i.test(shell), false);
  }
});

import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

const DASHBOARD_SOURCE = new URL(
  "./files/saas-starter/app/dashboard/page.tsx",
  import.meta.url,
);

describe("saas-starter dashboard template", () => {
  it("uses the shared conversation shell instead of a fake local sidebar", async () => {
    const source = await Deno.readTextFile(DASHBOARD_SOURCE);

    assertStringIncludes(source, "ConversationsProvider");
    assertStringIncludes(source, "ChatSidebar.Root");
    assertStringIncludes(source, "ChatSidebar.NewButton");
    assertStringIncludes(source, "ChatSidebar.List");
    assertStringIncludes(source, "AppShell");
    assertStringIncludes(source, 'storageKey="saas-conversations"');
    assertEquals(source.includes("INITIAL_CONVERSATIONS"), false);
    assertEquals(source.includes("useState"), false);
  });
});

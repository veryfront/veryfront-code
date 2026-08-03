import "#veryfront/schemas/_test-setup.ts";
import * as integrationExports from "#veryfront/integrations/index.ts";
import { createMCPServer } from "#veryfront/mcp/server.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { VeryfrontConfigInput } from "#veryfront/config/schemas/index.ts";

const configInputHasIntegrations: "integrations" extends keyof VeryfrontConfigInput ? true : false =
  true;

describe("source integration policy cutover", () => {
  it("keeps the canonical narrowing policy in veryfront.config", () => {
    assertEquals(configInputHasIntegrations, true);
  });

  it("does not restore integration config sync or MCP loader state", () => {
    const server = createMCPServer({
      enabled: true,
      auth: { type: "none", allowUnauthenticated: true },
    });

    assertEquals("syncIntegrationConfig" in integrationExports, false);
    assertEquals("setIntegrationLoader" in server, false);
  });
});

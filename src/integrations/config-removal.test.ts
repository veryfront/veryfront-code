import "#veryfront/schemas/_test-setup.ts";
import * as integrationExports from "#veryfront/integrations/index.ts";
import { createMCPServer } from "#veryfront/mcp/server.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { VeryfrontConfigInput } from "#veryfront/config/schemas/index.ts";

const configInputHasIntegrations: "integrations" extends keyof VeryfrontConfigInput ? true : false =
  false;

describe("integration config removal", () => {
  it("does not expose integration configuration in veryfront.config", () => {
    assertEquals(configInputHasIntegrations, false);
  });

  it("does not expose integration config sync", () => {
    const server = createMCPServer({
      enabled: true,
      auth: { type: "none", allowUnauthenticated: true },
    });

    assertEquals("syncIntegrationConfig" in integrationExports, false);
    assertEquals("setIntegrationLoader" in server, false);
  });
});

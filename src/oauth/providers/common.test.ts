import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { slackConfig } from "./common.ts";

describe("oauth provider configs", () => {
  it("keeps the Slack runtime scopes aligned with the connector surface", () => {
    assertEquals(slackConfig.defaultScopes, [
      "channels:history",
      "channels:read",
      "chat:write",
      "users:read",
      "im:history",
      "im:read",
    ]);
  });
});

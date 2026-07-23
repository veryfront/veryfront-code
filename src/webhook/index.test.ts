import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import * as webhookApi from "./index.ts";

describe("webhook public exports", () => {
  it("exposes only the canonical runtime factories and guards", () => {
    assertEquals(Object.keys(webhookApi).sort(), [
      "discoverWebhooks",
      "isWebhookDefinition",
      "webhook",
    ]);
  });
});

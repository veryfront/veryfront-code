import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import * as discoveryModule from "./discovery.ts";
import * as factoryModule from "./factory.ts";
import * as webhookModule from "./index.ts";
import * as publicWebhookModule from "veryfront/webhook";
import * as runtimeModule from "./runtime.ts";
import * as typesModule from "./types.ts";
import * as validationModule from "./validation.ts";

const expectedRuntimeExports = [
  "discoverWebhooks",
  "isWebhookDefinition",
  "isWebhookId",
  "prepareWebhookInvocation",
  "webhook",
];

describe("webhook/index.ts exports", () => {
  it("preserves the runtime export surface for veryfront/webhook", () => {
    assertEquals(Object.keys(webhookModule).sort(), expectedRuntimeExports);
    assertEquals(Object.keys(publicWebhookModule).sort(), expectedRuntimeExports);
  });

  it("keeps public exports wired to their owning modules", () => {
    assertStrictEquals(webhookModule.webhook, factoryModule.webhook);
    assertStrictEquals(webhookModule.discoverWebhooks, discoveryModule.discoverWebhooks);
    assertStrictEquals(
      webhookModule.prepareWebhookInvocation,
      runtimeModule.prepareWebhookInvocation,
    );
    assertStrictEquals(webhookModule.isWebhookId, validationModule.isWebhookId);
    assertStrictEquals(webhookModule.isWebhookDefinition, typesModule.isWebhookDefinition);
    assertStrictEquals(publicWebhookModule.webhook, webhookModule.webhook);
    assertStrictEquals(publicWebhookModule.discoverWebhooks, webhookModule.discoverWebhooks);
    assertStrictEquals(
      publicWebhookModule.isWebhookDefinition,
      webhookModule.isWebhookDefinition,
    );
    assertStrictEquals(
      publicWebhookModule.prepareWebhookInvocation,
      webhookModule.prepareWebhookInvocation,
    );
    assertStrictEquals(publicWebhookModule.isWebhookId, webhookModule.isWebhookId);
  });
});

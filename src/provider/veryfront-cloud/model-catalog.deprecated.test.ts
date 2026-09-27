import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import * as barrel from "#veryfront/provider";
import {
  __resetVeryfrontCloudCatalogForTests,
  __setVeryfrontCloudCatalogForTests,
} from "./catalog-client.ts";
import * as catalog from "./model-catalog.ts";
import * as shim from "./model-catalog.deprecated.ts";
import {
  DEFAULT_VERYFRONT_CLOUD_MODEL_ID as TABLE_DEFAULT_MODEL_ID,
  VERYFRONT_CLOUD_CHAT_MODEL_ENTRIES,
} from "./model-catalog.data.ts";

describe("provider/veryfront-cloud/model-catalog deprecated exports", () => {
  afterEach(__resetVeryfrontCloudCatalogForTests);

  it("keeps the shipped model list whatever the served catalog says", () => {
    __setVeryfrontCloudCatalogForTests({ models: [], defaultModelId: "acme/acme-1" });

    assertEquals(
      shim.VERYFRONT_CLOUD_CHAT_MODELS.map((model) => model.modelId),
      VERYFRONT_CLOUD_CHAT_MODEL_ENTRIES.map((model) => model.modelId),
    );
    assertEquals(shim.DEFAULT_VERYFRONT_CLOUD_CHAT_MODEL.id, TABLE_DEFAULT_MODEL_ID);
    assertEquals(shim.findVeryfrontCloudModel("opus")?.modelId, "anthropic/claude-opus-4-8");
    assertEquals(
      shim.findVeryfrontCloudModelByModelId("veryfront-cloud/google/gemini-2.5-pro")?.id,
      "gemini-2.5-pro",
    );
    assertEquals(
      shim.groupVeryfrontCloudModelsByProvider().map((group) => group.provider),
      ["anthropic", "openai", "google", "mistral", "moonshotai"],
    );
  });

  it("is what the catalog module and the public barrel export under the same names", () => {
    for (
      const name of [
        "VERYFRONT_CLOUD_CHAT_MODELS",
        "DEFAULT_VERYFRONT_CLOUD_CHAT_MODEL",
        "findVeryfrontCloudModel",
        "findVeryfrontCloudModelByModelId",
        "groupVeryfrontCloudModelsByProvider",
      ] as const
    ) {
      assertEquals(catalog[name], shim[name], name);
    }
    for (
      const name of [
        "VERYFRONT_CLOUD_CHAT_MODELS",
        "findVeryfrontCloudModel",
        "findVeryfrontCloudModelByModelId",
        "groupVeryfrontCloudModelsByProvider",
      ] as const
    ) {
      assertEquals(barrel[name], shim[name], name);
    }
  });
});

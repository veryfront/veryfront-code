import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  DEFAULT_VERYFRONT_CLOUD_MODEL_ID,
  findVeryfrontCloudModel,
  resolveVeryfrontCloudModelId,
  resolveVeryfrontCloudProviderFromModelId,
  VERYFRONT_CLOUD_CHAT_MODELS,
} from "#veryfront/provider/veryfront-cloud/model-catalog.ts";
import { parseVeryfrontCloudModelId } from "#veryfront/provider/veryfront-cloud/shared.ts";
import {
  assertCatalogInvariants,
  buildModelCatalogData,
  type ChatModelEntry,
  describeUnroutableModelId,
} from "../../../scripts/build/model-catalog-mapping.ts";
import { MODEL_CATALOG_OVERLAY } from "../../../scripts/build/model-catalog-overlay.ts";

/**
 * The catalog generator refuses a model id the package could not use, so that
 * a generated entry is never published and unusable. That rule restates what
 * the runtime requires, and a restatement can drift.
 *
 * This pins the two together by behaviour rather than by matching source text:
 * for every id below, the generator accepts it exactly when the runtime can
 * both take a provider from it and parse it into a model. It is an integration
 * test because it loads the real runtime alongside the build script.
 */
const MODEL_IDS: readonly string[] = [
  // Usable: nothing constrains the characters after the provider segment.
  "openai/gpt-model",
  "anthropic/claude-model",
  "beta-works/family/model:v1",
  "beta-works/ns:model@2026-01-01",
  "a1/b2",
  "beta.works/model",
  // No provider segment the runtime can take.
  "no-slash-at-all",
  "/leading-slash",
  "veryfront-cloud/already-prefixed",
  "UPPER/case",
  "under_score/model",
  "prototype/model",
  "constructor/model",
  // A provider segment, but nothing usable after it.
  "openai/",
  "openai/ model",
  "openai/model ",
];

/** True when the runtime can carry this id all the way to a built model. */
function runtimeAccepts(modelId: string): boolean {
  if (resolveVeryfrontCloudProviderFromModelId(modelId) === undefined) {
    return false;
  }
  try {
    parseVeryfrontCloudModelId(modelId, "language");
    return true;
  } catch {
    return false;
  }
}

describe("veryfront-cloud model id rule", () => {
  for (const modelId of MODEL_IDS) {
    it(`agrees with the runtime about ${JSON.stringify(modelId)}`, () => {
      assertEquals(
        describeUnroutableModelId(modelId) === undefined,
        runtimeAccepts(modelId),
        `the generator and the runtime disagree about ${
          JSON.stringify(modelId)
        }`,
      );
    });
  }

  it("covers both answers, so agreement is not vacuous", () => {
    const accepted = MODEL_IDS.filter((modelId) => runtimeAccepts(modelId));

    assertEquals(accepted.length > 0, true);
    assertEquals(accepted.length < MODEL_IDS.length, true);
  });
});

/**
 * A payload shaped like the served catalog, with obviously fake model values.
 * The real payload is not copied into this repository.
 *
 * The surface is a served field, so every model carries one. One vendor is
 * named for real: the overlay retains an Anthropic thinking row for a model
 * the catalog no longer lists, and that row is only coherent while its
 * provider routes on the Anthropic surface. A payload that left the provider
 * out would route it on the default surface instead and say this overlay is
 * broken, which is a statement about the fixture, not about the overlay.
 */
function representativePayload(): Record<string, unknown> {
  const model = (
    id: string,
    provider: string,
    label: string,
    surface: string,
  ) => ({
    id,
    modelId: `${provider}/${id}`,
    provider,
    providerLabel: label,
    surface,
    name: id,
    description: `${id} does not exist`,
    capabilities: { reasoning: true },
  });
  return {
    models: [
      model("mystery-1", "acme-labs", "Acme Labs", "openai"),
      model("riddle-9", "beta-works", "Beta Works", "openai"),
      model("plain-3", "beta-works", "Beta Works", "openai"),
      model("quiet-0", "anthropic", "Anthropic", "anthropic"),
    ],
    providers: ["acme-labs", "beta-works", "anthropic"],
    defaultModelId: "beta-works/riddle-9",
  };
}

/**
 * The published catalog has to be reachable through the runtime that reads it.
 *
 * Every generated value is resolved back through the functions callers use:
 * `resolveVeryfrontCloudModelId` for a published id and for a canonical model
 * id, `findVeryfrontCloudModel` for the entry itself, and
 * `resolveVeryfrontCloudProviderFromModelId` for the provider. A generated
 * value that no runtime lookup can return is the failure this holds shut, so a
 * new way of producing one is caught here rather than found in the catalog.
 */
describe("veryfront-cloud catalog round trip", () => {
  it("resolves every shipped entry back to itself", () => {
    assertEquals(VERYFRONT_CLOUD_CHAT_MODELS.length > 0, true);

    for (const entry of VERYFRONT_CLOUD_CHAT_MODELS) {
      assertEquals(
        resolveVeryfrontCloudModelId(entry.id),
        entry.modelId,
        `the published id "${entry.id}" does not resolve to its model`,
      );
      assertEquals(
        resolveVeryfrontCloudModelId(entry.modelId),
        entry.modelId,
        `the model id "${entry.modelId}" does not resolve to itself`,
      );
      assertEquals(findVeryfrontCloudModel(entry.id)?.modelId, entry.modelId);
      assertEquals(
        resolveVeryfrontCloudProviderFromModelId(entry.modelId) !== undefined,
        true,
        `no provider can be taken from "${entry.modelId}"`,
      );
    }
  });

  it("resolves the shipped default to an entry", () => {
    const entry = findVeryfrontCloudModel(DEFAULT_VERYFRONT_CLOUD_MODEL_ID);

    assertEquals(entry !== undefined, true);
    assertEquals(
      resolveVeryfrontCloudModelId(DEFAULT_VERYFRONT_CLOUD_MODEL_ID),
      entry?.modelId,
    );
  });

  it("generates entries that satisfy what that round trip depends on", () => {
    // The runtime reads the catalog it ships with and cannot be pointed at
    // another, so a freshly generated catalog is held to the conditions the
    // round trip above proves sufficient: a published id is reachable when it
    // is the model id or carries no slash, model ids are unique, and every
    // model id yields a provider.
    const data = buildModelCatalogData(
      representativePayload(),
      MODEL_CATALOG_OVERLAY,
    );
    assertCatalogInvariants(data);

    const reachable = (entry: ChatModelEntry) =>
      entry.id === entry.modelId || !entry.id.includes("/");

    assertEquals(data.chatModels.length > 0, true);
    for (const entry of data.chatModels) {
      assertEquals(
        reachable(entry),
        true,
        `"${entry.id}" would not resolve to its model`,
      );
      assertEquals(describeUnroutableModelId(entry.modelId), undefined);
    }
    assertEquals(
      data.chatModels.some((entry) => entry.id === data.defaultModelId),
      true,
    );

    // The same conditions hold of every shipped entry, which is what makes the
    // round trip above the evidence that they are sufficient.
    for (const entry of VERYFRONT_CLOUD_CHAT_MODELS) {
      assertEquals(reachable(entry), true);
    }
  });
});

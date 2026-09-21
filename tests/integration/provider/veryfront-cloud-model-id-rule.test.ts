import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { resolveVeryfrontCloudProviderFromModelId } from "#veryfront/provider/veryfront-cloud/model-catalog.ts";
import { parseVeryfrontCloudModelId } from "#veryfront/provider/veryfront-cloud/shared.ts";
import { describeUnroutableModelId } from "../../../scripts/build/model-catalog-mapping.ts";

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
  if (resolveVeryfrontCloudProviderFromModelId(modelId) === undefined) return false;
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
        `the generator and the runtime disagree about ${JSON.stringify(modelId)}`,
      );
    });
  }

  it("covers both answers, so agreement is not vacuous", () => {
    const accepted = MODEL_IDS.filter((modelId) => runtimeAccepts(modelId));

    assertEquals(accepted.length > 0, true);
    assertEquals(accepted.length < MODEL_IDS.length, true);
  });
});

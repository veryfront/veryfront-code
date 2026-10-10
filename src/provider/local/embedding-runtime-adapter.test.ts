import { assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createLocalEmbeddingModel } from "./embedding-runtime-adapter.ts";

describe("local embedding cancellation", () => {
  it("rejects before loading a local model when already cancelled", async () => {
    const model = createLocalEmbeddingModel("invalid-model-must-not-load");
    const abortSignal = AbortSignal.abort(new DOMException("cancelled", "AbortError"));
    await assertRejects(
      async () => await model.doEmbed({ values: ["document"], abortSignal }),
      DOMException,
      "cancelled",
    );
  });
});

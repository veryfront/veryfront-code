import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { scriptedModel, type ScriptedModelOptions } from "./model-runtime.test-helpers.ts";

const CALL_OPTIONS = { prompt: [] } as const;

describe("scriptedModel turn exhaustion", () => {
  it("rejects an unexpected generate call", async () => {
    const model = scriptedModel([{ text: "only turn" }], { only: "generate" });

    await model.doGenerate(CALL_OPTIONS);
    await assertRejects(
      async () => await model.doGenerate(CALL_OPTIONS),
      Error,
      "scripted model: exhausted 1 turn(s); unexpected call 2",
    );
    assertEquals(model.callCount, 2);
  });

  it("rejects an unexpected stream call", async () => {
    const model = scriptedModel([{ text: "only turn" }], { only: "stream" });

    await model.doStream(CALL_OPTIONS);
    await assertRejects(
      async () => await model.doStream(CALL_OPTIONS),
      Error,
      "scripted model: exhausted 1 turn(s); unexpected call 2",
    );
    assertEquals(model.callCount, 2);
  });

  it("repeats the final turn only when explicitly requested", async () => {
    const generateModel = scriptedModel([{ text: "repeat me" }], {
      only: "generate",
      repeatLastTurn: true,
    });
    const streamModel = scriptedModel([{ text: "repeat me" }], {
      only: "stream",
      repeatLastTurn: true,
    });

    const firstGenerate = await generateModel.doGenerate(CALL_OPTIONS);
    const repeatedGenerate = await generateModel.doGenerate(CALL_OPTIONS);
    const firstStream = await streamModel.doStream(CALL_OPTIONS);
    const repeatedStream = await streamModel.doStream(CALL_OPTIONS);

    assertEquals(repeatedGenerate, firstGenerate);
    assertEquals(
      await Array.fromAsync(repeatedStream.stream),
      await Array.fromAsync(firstStream.stream),
    );
    assertEquals(generateModel.callCount, 2);
    assertEquals(streamModel.callCount, 2);
  });
});

const malformedOptions = {
  // @ts-expect-error Provider metadata reconcilers must return metadata, not a string.
  reconcileProviderMetadata: () => "invalid",
} satisfies ScriptedModelOptions;
void malformedOptions;

const misspelledOptions = {
  // @ts-expect-error Misspelled runtime extension options are rejected.
  reconcileProviderMetdata: () => undefined,
} satisfies ScriptedModelOptions;
void misspelledOptions;

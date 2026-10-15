import { describe, it } from "#veryfront/testing/bdd.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import type { ModelRuntime } from "#veryfront/provider";
import { createRenewingLocalModel } from "./connected-local-model.ts";

describe("local worker inference renewal", () => {
  it("uses the renewed credential when the same model retries after lease rotation", async () => {
    let credential = "first";
    const dispatched: string[] = [];
    const model = createRenewingLocalModel(
      () => credential,
      (token) => ({
        modelId: "local-model",
        doStream: () => {
          dispatched.push(token);
          return Promise.resolve({});
        },
        doGenerate: () => {
          dispatched.push(token);
          return Promise.resolve({});
        },
      } as unknown as ModelRuntime),
    );
    await model.doStream({} as Parameters<ModelRuntime["doStream"]>[0]);
    credential = "renewed";
    await model.doStream({} as Parameters<ModelRuntime["doStream"]>[0]);
    await model.doGenerate({} as Parameters<ModelRuntime["doGenerate"]>[0]);
    assertEquals(dispatched, ["first", "renewed", "renewed"]);
  });
});

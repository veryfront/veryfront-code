import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import * as localApi from "./index.ts";
import * as publicApi from "veryfront/extensions/llm";

describe("extensions/llm public surface", () => {
  it("exports the exact runtime contract", () => {
    assertEquals(Object.keys(localApi).sort(), [
      "LLMProviderRegistryName",
      "createLLMProviderRegistry",
    ]);
    assertEquals(publicApi, localApi);
  });
});

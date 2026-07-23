import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  extractOpenAIEmbeddings,
  extractOpenAIUsageTokens,
  isNumberArray,
} from "./provider-embedding-responses.ts";

describe("provider/runtime-loader/provider-embedding-responses", () => {
  it("accepts finite non-empty embedding vectors", () => {
    assertEquals(isNumberArray([0, 0.5, -1]), true);
    assertEquals(extractOpenAIEmbeddings({ data: [{ embedding: [0, 1] }] }), [[0, 1]]);
  });

  it("rejects empty and non-finite embedding vectors", () => {
    assertEquals(isNumberArray([]), false);
    assertEquals(isNumberArray([Number.NaN]), false);
    assertThrows(
      () => extractOpenAIEmbeddings({ data: [] }),
      Error,
      "data array",
    );
    assertThrows(
      () => extractOpenAIEmbeddings({ data: [{ embedding: [Number.POSITIVE_INFINITY] }] }),
      Error,
      "embedding vector",
    );
  });

  it("rejects inconsistent embedding dimensions", () => {
    assertThrows(
      () =>
        extractOpenAIEmbeddings({
          data: [{ embedding: [0, 1] }, { embedding: [0, 1, 2] }],
        }),
      Error,
      "dimensions",
    );
  });

  it("ignores invalid usage counters", () => {
    assertEquals(extractOpenAIUsageTokens({ usage: { total_tokens: -1 } }), undefined);
    assertEquals(extractOpenAIUsageTokens({ usage: { total_tokens: Number.NaN } }), undefined);
  });
});

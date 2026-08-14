import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  appendOpenAIStreamToolArgument,
  joinOpenAIStreamToolArguments,
  MAX_OPENAI_STREAM_TOOL_ARGUMENT_BYTES,
  MAX_OPENAI_STREAM_TOOL_ARGUMENT_FRAGMENTS,
  type OpenAIStreamToolArgumentBudget,
} from "./openai-tool-input.ts";

function emptyBudget(): OpenAIStreamToolArgumentBudget {
  return { bytes: 0, fragments: 0 };
}

describe("ext-llm-openai/openai-tool-input", () => {
  it("accepts far more non-empty fragments than the fragment cap while under the byte budget", () => {
    // The provider's tokenizer decides how finely arguments are chunked, so a
    // caller cannot control fragment count. Counting non-empty fragments against
    // the flood guard rejected ordinary tool calls at roughly 2-8% of the byte
    // budget they were nominally allowed -- every scheduled run of one project
    // failed on this hourly. The byte budget is what bounds content.
    const budget = emptyBudget();
    const chunks: string[] = [];
    const fragment = '{"a":1},';
    const count = MAX_OPENAI_STREAM_TOOL_ARGUMENT_FRAGMENTS * 4;

    let limit: string | undefined;
    for (let i = 0; i < count; i++) {
      limit = appendOpenAIStreamToolArgument(budget, chunks, fragment);
      if (limit) break;
    }

    assertEquals(limit, undefined, `expected no limit for ${count} small fragments`);
    assertEquals(chunks.length, count, "every non-empty fragment must be kept");
    assertEquals(
      budget.bytes < MAX_OPENAI_STREAM_TOOL_ARGUMENT_BYTES,
      true,
      "the payload must still be well inside the byte budget",
    );
    assertEquals(joinOpenAIStreamToolArguments(chunks).length, fragment.length * count);
  });

  it("still stops an unbounded flood of zero-byte fragments", () => {
    // Zero-byte fragments never advance the byte budget, so they are the only
    // ones that can arrive without bound. They are what this cap guards.
    const budget = emptyBudget();
    const chunks: string[] = [];

    let limit: string | undefined;
    for (let i = 0; i < MAX_OPENAI_STREAM_TOOL_ARGUMENT_FRAGMENTS + 10; i++) {
      limit = appendOpenAIStreamToolArgument(budget, chunks, "");
      if (limit) break;
    }

    assertEquals(limit, "fragments", "empty-fragment floods must still be rejected");
    assertEquals(chunks.length, 0, "empty fragments are never appended");
  });

  it("still enforces the byte budget", () => {
    const budget = emptyBudget();
    const chunks: string[] = [];
    const big = "x".repeat(MAX_OPENAI_STREAM_TOOL_ARGUMENT_BYTES);

    assertEquals(appendOpenAIStreamToolArgument(budget, chunks, big), undefined);
    assertEquals(appendOpenAIStreamToolArgument(budget, chunks, "y"), "bytes");
  });

  it("counts multi-byte characters by UTF-8 length, not code units", () => {
    const budget = emptyBudget();
    const chunks: string[] = [];
    appendOpenAIStreamToolArgument(budget, chunks, "€");
    assertEquals(budget.bytes, 3);
  });
});

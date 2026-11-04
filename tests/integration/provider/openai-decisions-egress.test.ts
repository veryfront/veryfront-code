import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { OpenAIProvider } from "../../../extensions/ext-llm-openai/src/index.ts";

const options = {
  input: "A synthetic example.",
  questions: [{ name: "relevant", type: "predicate", instructions: "Is it relevant?" }],
} as const;

function result() {
  return {
    model: "gpt-6-luna",
    answers: [{ name: "relevant", type: "predicate", probability: 0.8 }],
    usage: { input_tokens: 42, output_tokens: 0, total_tokens: 42 },
  };
}

describe("OpenAI Decisions default transport", () => {
  it("blocks internal destinations before dispatch when using its default transport", async () => {
    let calls = 0;
    await withMockFetch(() => {
      calls++;
      return Promise.resolve(Response.json(result()));
    }, async () => {
      const runtime = new OpenAIProvider().createDecisions("gpt-6-luna", {
        credential: "test-key",
        baseURL: "http://169.254.169.254/v1",
      });
      await assertRejects(() => runtime.decide(options));
    });
    assertEquals(calls, 0, "provider credentials must not reach internal destinations");
  });

  it("does not follow a provider redirect to a different origin", async () => {
    let calls = 0;
    await withMockFetch(() => {
      calls++;
      return Promise.resolve(
        new Response(null, {
          status: 302,
          headers: { location: "https://other.example/decisions" },
        }),
      );
    }, async () => {
      const runtime = new OpenAIProvider().createDecisions("gpt-6-luna", {
        credential: "test-key",
      });
      await assertRejects(() => runtime.decide(options));
    });
    assertEquals(calls, 1, "a redirect must not forward provider credentials");
  });
});

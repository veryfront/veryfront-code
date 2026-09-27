import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withEnv } from "#veryfront/testing";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { __resetVeryfrontCloudCatalogForTests } from "#veryfront/provider/veryfront-cloud/catalog-client.ts";
import { judges } from "veryfront/eval";

describe("eval judges with Veryfront Cloud", () => {
  it("stops waiting for the model catalog when the evaluation is cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    // The catalog request does not answer until the test ends; a cancelled judge
    // must not wait for it.
    let release: (response: Response) => void = () => {};
    const pending = new Promise<Response>((resolve) => release = resolve);
    const hanging = () => pending;
    try {
      const started = Date.now();
      const result = await withEnv(
        { VERYFRONT_API_TOKEN: "vf_judge_test", VERYFRONT_PROJECT_SLUG: "judge-test" },
        () =>
          withMockFetch(hanging, () =>
            judges.llm.rubric({ model: "openai/gpt-5-nano" })({
              input: "Question",
              output: { text: "Answer" },
              metadata: {},
              rubric: "Correct.",
              signal: controller.signal,
            })),
      );
      assertEquals(result.pass, false);
      assertEquals(Date.now() - started < 1_000, true);
    } finally {
      // Let the shared request settle so its timeout is cleared.
      release(new Response(null, { status: 503 }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      __resetVeryfrontCloudCatalogForTests();
    }
  });
});

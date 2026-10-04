import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { getCanonicalRunStatus } from "#veryfront/agent/conversation/durable.ts";
it("polls canonical lifecycle state without fabricating durable append cursors", async () => {
  const id = "11111111-1111-4111-8111-111111111111";
  let url = "";
  await withMockFetch((input) => {
    url = String(input);
    return Promise.resolve(Response.json({ id, status: "waiting" }));
  }, async () => {
    const run = await getCanonicalRunStatus({
      authToken: "invocation",
      apiUrl: "https://api.example.test",
      runId: "original",
      canonicalRunId: id,
    });
    assertEquals(url, `https://api.example.test/runs/${id}`);
    assertEquals(run, { runId: "original", status: "waiting_for_tool" });
  });
});

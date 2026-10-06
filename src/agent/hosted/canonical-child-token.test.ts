import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { createHostedRunEventWriterCapability } from "./child-run-event-writer-token.ts";
it("delegates to the canonical child using the unchanged parent capability", async () => {
  const id = "11111111-1111-4111-8111-111111111111";
  let request: Request | undefined;
  const parent = createHostedRunEventWriterCapability({
    apiUrl: "https://api.example.test",
    runId: "parent-original",
    runEventAppendToken: "parent-authority",
    fetch: (input, init) => {
      request = new Request(input, init);
      return Promise.resolve(
        Response.json({
          token: "child-authority",
          token_type: "Bearer",
          expires_at: "2026-10-04T00:00:00Z",
          run_id: id,
          permissions: ["run.events.append"],
        }, { status: 201, headers: { "Cache-Control": "private, no-store" } }),
      );
    },
  });
  const child = await parent.mintChildRunEventWriterCapability("child-original", undefined, id);
  assertEquals(request!.url, `https://api.example.test/runs/${id}/event-tokens`);
  assertEquals(request!.headers.get("Authorization"), "Bearer parent-authority");
  assertEquals(JSON.stringify(child), "{}");
  await assertRejects(() => parent.mintChildRunEventWriterCapability("child-original"));
});

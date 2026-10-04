import "#veryfront/schemas/_test-setup.ts";
import { assertRejects } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { prepareHostedChatExecution } from "./chat-preparation.ts";
it("rejects a hosted conversation without an API-admitted root before persistence or runtime preparation", async () => {
  await assertRejects(
    () =>
      prepareHostedChatExecution(
        { request: { conversationId: "11111111-1111-4111-8111-111111111111" } } as never,
      ),
    Error,
    "API-admitted durable root run",
  );
});

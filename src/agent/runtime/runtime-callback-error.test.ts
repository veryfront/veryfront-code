import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { agent } from "../factory.ts";
import { scriptedModel } from "./model-runtime.test-helpers.ts";

function parseDataStreamEvents(body: string): Array<Record<string, unknown>> {
  return body.split("\n").filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>);
}

describe("agent runtime callback errors", () => {
  it("keeps application callback failures on the generic stream-error path", async () => {
    for (
      const message of [
        "Database capacity exceeded",
        "Callback failed: credit limit reached",
        "Audit sink returned 429",
      ]
    ) {
      const model = scriptedModel([{ text: "complete" }], {
        modelId: "test/callback-error",
        only: "stream",
      });
      const assistant = agent({
        id: "callback-error-agent",
        system: "Complete the request.",
        maxSteps: 1,
        resolveModelTransport: () => Promise.resolve({ model }),
      });
      const response = await assistant.stream({
        input: "Run",
        onFinish: () => {
          throw new Error(message);
        },
      });

      const errorEvent = parseDataStreamEvents(await response.toDataStreamResponse().text()).find(
        (event) => event.type === "error",
      );
      assertEquals(errorEvent, { type: "error", error: message }, message);
    }
  });
});

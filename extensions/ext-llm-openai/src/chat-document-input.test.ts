import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { registerModelProvider } from "veryfront/provider";
import { generate } from "veryfront/llm";
import { createOpenAIModelRuntime } from "./openai-provider.ts";

describe("OpenAI-compatible Chat Completions document input", () => {
  it("rejects a PDF before inference and sends no provider request", async () => {
    const requests: string[] = [];
    const runtime = createOpenAIModelRuntime({
      apiKey: "test-local-key",
      baseURL: "https://example.compatible.test/v1",
      fetch: (input) => {
        requests.push(String(input));
        return Promise.resolve(Response.json({ choices: [] }));
      },
    }, "compatible-model");
    const dispose = registerModelProvider("compatible-recording", () => runtime);
    try {
      await assertRejects(
        () =>
          generate({
            model: "compatible-recording/compatible-model",
            input: [{
              id: "document-request",
              role: "user",
              parts: [
                { type: "text", text: "Classify" },
                {
                  type: "file",
                  url: "data:application/pdf;base64,JVBERi0xLjQK",
                  mediaType: "application/pdf",
                  filename: "request.pdf",
                },
              ],
            }],
          }),
        TypeError,
        'Chat Completions does not support file input "request.pdf" (application/pdf)',
      );
      assertEquals(requests, []);
    } finally {
      dispose();
    }
  });
});

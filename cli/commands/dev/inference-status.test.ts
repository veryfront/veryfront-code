import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { listInferenceOptions } from "./inference-status.ts";

describe("commands/dev/inference-status", () => {
  it("reports the Veryfront Cloud AI Gateway only with project context", () => {
    assertEquals(
      listInferenceOptions({
        apiToken: "<TOKEN>",
        projectSlug: "support-agent",
      }),
      ["Veryfront Cloud AI Gateway"],
    );
    assertEquals(listInferenceOptions({ apiToken: "<TOKEN>" }), []);
  });

  it("reports direct provider credentials without exposing their values", () => {
    assertEquals(
      listInferenceOptions({
        openaiApiKey: "<API_KEY>",
        anthropicApiKey: "<API_KEY>",
        googleApiKey: "<API_KEY>",
        mistralApiKey: "<API_KEY>",
      }),
      ["OpenAI direct", "Anthropic direct", "Google direct", "Mistral direct"],
    );
  });

  it("labels an OpenAI base URL as an OpenAI-compatible service", () => {
    assertEquals(
      listInferenceOptions({
        openaiApiKey: "<TOKEN>",
        openaiBaseUrl: "http://localhost:11434/v1",
      }),
      ["OpenAI-compatible service"],
    );
  });

  it("reports every available path in a stable order", () => {
    assertEquals(
      listInferenceOptions({
        apiToken: "<TOKEN>",
        projectSlug: "support-agent",
        openaiApiKey: "<API_KEY>",
      }),
      ["Veryfront Cloud AI Gateway", "OpenAI direct"],
    );
  });
});

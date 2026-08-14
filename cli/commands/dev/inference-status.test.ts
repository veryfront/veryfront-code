import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { listInferenceOptions } from "./inference-status.ts";

describe("commands/dev/inference-status", () => {
  it("reports the Veryfront Cloud AI Gateway whenever a token can reach it", () => {
    assertEquals(
      listInferenceOptions({
        apiToken: "<TOKEN>",
        projectSlug: "support-agent",
      }),
      ["Veryfront Cloud AI Gateway"],
    );
  });

  it("reports the gateway for a logged-in developer whose project is not linked yet", () => {
    // `veryfront login` alone is enough to serve inference through the gateway:
    // a freshly scaffolded project has no linked slug, and its chat route still
    // answers. Requiring a slug here left the banner silent on exactly the path
    // the quickstart tells a developer to use.
    assertEquals(
      listInferenceOptions({ apiToken: "<TOKEN>" }),
      ["Veryfront Cloud AI Gateway"],
    );
  });

  it("reports nothing when no credential can reach any provider", () => {
    assertEquals(listInferenceOptions({}), []);
    assertEquals(listInferenceOptions({ projectSlug: "support-agent" }), []);
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

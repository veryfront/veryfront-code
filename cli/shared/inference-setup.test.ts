import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  inferenceSetupOptionLines,
  NO_INFERENCE_HEADING,
  PROVIDER_KEY_ENV_NAMES,
} from "./inference-setup.ts";

describe("shared/inference-setup", () => {
  const text = inferenceSetupOptionLines().join("\n");

  it("names the Cloud AI Gateway path and says it publishes nothing", () => {
    assertStringIncludes(text, "Veryfront Cloud AI Gateway");
    assertStringIncludes(text, "veryfront login");
    assertStringIncludes(text, 'answer Yes to "Use Veryfront Cloud?"');
    assertStringIncludes(text, "publishes nothing");
  });

  it("names the account-level provider keys for OpenAI and Anthropic", () => {
    assertStringIncludes(text, "Provider keys");
    assertStringIncludes(text, "OpenAI or Anthropic");
  });

  it("names every provider key the runtime reads", () => {
    assertEquals([...PROVIDER_KEY_ENV_NAMES], [
      "OPENAI_API_KEY",
      "ANTHROPIC_API_KEY",
      "GOOGLE_API_KEY",
      "MISTRAL_API_KEY",
    ]);
    for (const name of PROVIDER_KEY_ENV_NAMES) assertStringIncludes(text, name);
    assertStringIncludes(text, ".env");
  });

  it("does not send the reader to push, which publishes the source", () => {
    assertEquals(text.includes("veryfront push"), false);
  });

  it("states what is missing without claiming no model can run", () => {
    // A project can run `local/...` models or a provider it registers in code,
    // which the CLI cannot see, so the heading names what was checked.
    assertEquals(
      NO_INFERENCE_HEADING,
      "No provider key or linked Cloud project found. To use hosted models, choose one:",
    );
  });

  it("follows the public copy rules", () => {
    assert(!/[–—]/.test(text), "copy must not use en or em dashes");
  });
});

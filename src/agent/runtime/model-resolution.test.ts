import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { deleteEnv, setEnv } from "#veryfront/compat/process.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  AUTO_AGENT_MODEL,
  normalizeAgentModelConfig,
  resolveConfiguredAgentModel,
  resolveRuntimeModel,
} from "./model-resolution.ts";

const MODEL_ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "OPENAI_API_KEY",
  "VERYFRONT_API_TOKEN",
  "VERYFRONT_DEFAULT_MODEL",
  "VERYFRONT_PROJECT_SLUG",
  "VERYFRONT_SERVICE_LAYER",
] as const;

function clearModelEnv(): void {
  for (const key of MODEL_ENV_KEYS) {
    try {
      deleteEnv(key);
    } catch {
      // expected: env may already be unset
    }
  }
}

describe("agent/runtime/model-resolution", () => {
  afterEach(() => {
    clearModelEnv();
  });

  it("normalizes missing models to auto", () => {
    assertEquals(normalizeAgentModelConfig(), AUTO_AGENT_MODEL);
    assertEquals(normalizeAgentModelConfig("   "), AUTO_AGENT_MODEL);
  });

  it("preserves explicit provider models", () => {
    assertEquals(
      normalizeAgentModelConfig("veryfront-cloud/anthropic/claude-sonnet-4-6"),
      "veryfront-cloud/anthropic/claude-sonnet-4-6",
    );
  });

  it("resolves auto to the local default model string", () => {
    assertEquals(resolveConfiguredAgentModel(), "local/smollm2-135m");
    assertEquals(resolveConfiguredAgentModel("auto"), "local/smollm2-135m");
  });

  it("passes explicit models through unchanged", () => {
    assertEquals(
      resolveConfiguredAgentModel("openai/gpt-4o"),
      "openai/gpt-4o",
    );
  });

  it("upgrades legacy bare model ids to provider/model strings", () => {
    assertEquals(
      resolveConfiguredAgentModel("claude-opus-4-6"),
      "anthropic/claude-opus-4-6",
    );
    assertEquals(
      resolveConfiguredAgentModel("opus"),
      "anthropic/claude-opus-4-6",
    );
    assertEquals(
      resolveConfiguredAgentModel("gpt-5.2"),
      "openai/gpt-5.2",
    );
    assertEquals(
      resolveConfiguredAgentModel("kimi-k2.5"),
      "moonshotai/kimi-k2.5",
    );
  });

  it("upgrades auto/local models to the default Veryfront cloud model when bootstrap is present", () => {
    setEnv("VERYFRONT_API_TOKEN", "vf_test_runtime");
    setEnv("VERYFRONT_PROJECT_SLUG", "demo-project");

    assertEquals(
      resolveRuntimeModel(),
      "veryfront-cloud/anthropic/claude-sonnet-4-6",
    );
  });

  it("routes explicit openai models through veryfront-cloud when only hosted bootstrap is available", () => {
    setEnv("VERYFRONT_API_TOKEN", "vf_test_runtime");
    setEnv("VERYFRONT_PROJECT_SLUG", "demo-project");

    assertEquals(
      resolveRuntimeModel("openai/gpt-5.4"),
      "veryfront-cloud/openai/gpt-5.4",
    );
  });

  it("routes catalog Gemini and Kimi models through veryfront-cloud when only hosted bootstrap is available", () => {
    setEnv("VERYFRONT_API_TOKEN", "vf_test_runtime");
    setEnv("VERYFRONT_PROJECT_SLUG", "demo-project");

    assertEquals(
      resolveRuntimeModel("google-ai-studio/gemini-2.5-flash"),
      "veryfront-cloud/google-ai-studio/gemini-2.5-flash",
    );
    assertEquals(
      resolveRuntimeModel("moonshotai/kimi-k2.5"),
      "veryfront-cloud/moonshotai/kimi-k2.5",
    );
    assertEquals(
      resolveRuntimeModel("kimi-k2.5"),
      "veryfront-cloud/moonshotai/kimi-k2.5",
    );
  });

  it("keeps explicit provider models unchanged when native credentials are configured", () => {
    setEnv("VERYFRONT_API_TOKEN", "vf_test_runtime");
    setEnv("VERYFRONT_PROJECT_SLUG", "demo-project");
    setEnv("OPENAI_API_KEY", "sk-test");

    assertEquals(
      resolveRuntimeModel("openai/gpt-5.4"),
      "openai/gpt-5.4",
    );
  });

  it("routes explicit Gemini models through the direct Google provider when native credentials are configured", () => {
    setEnv("VERYFRONT_API_TOKEN", "vf_test_runtime");
    setEnv("VERYFRONT_PROJECT_SLUG", "demo-project");
    setEnv("GOOGLE_API_KEY", "google-test");

    assertEquals(
      resolveRuntimeModel("google-ai-studio/gemini-2.5-flash"),
      "google/gemini-2.5-flash",
    );
  });

  it("preserves explicit veryfront-cloud models", () => {
    setEnv("VERYFRONT_API_TOKEN", "vf_test_runtime");
    setEnv("VERYFRONT_PROJECT_SLUG", "demo-project");

    assertEquals(
      resolveRuntimeModel("veryfront-cloud/openai/gpt-5.4"),
      "veryfront-cloud/openai/gpt-5.4",
    );
  });
});

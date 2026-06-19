import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
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
  "MISTRAL_API_KEY",
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

  it("resolves auto to the default Veryfront Cloud model string", () => {
    assertEquals(
      resolveConfiguredAgentModel(),
      "veryfront-cloud/anthropic/claude-sonnet-4-6",
    );
    assertEquals(
      resolveConfiguredAgentModel("auto"),
      "veryfront-cloud/anthropic/claude-sonnet-4-6",
    );
  });

  it("passes explicit models through unchanged", () => {
    assertEquals(
      resolveConfiguredAgentModel("openai/gpt-4o"),
      "openai/gpt-4o",
    );
  });

  it("upgrades legacy bare model ids to provider/model strings", () => {
    assertEquals(
      resolveConfiguredAgentModel("claude-opus-4-8"),
      "anthropic/claude-opus-4-8",
    );
    assertEquals(
      resolveConfiguredAgentModel("opus"),
      "anthropic/claude-opus-4-8",
    );
    assertEquals(
      resolveConfiguredAgentModel("gpt-5.5"),
      "openai/gpt-5.5",
    );
    assertEquals(
      resolveConfiguredAgentModel("gpt-5.4-mini"),
      "openai/gpt-5.4-mini",
    );
    assertEquals(
      resolveConfiguredAgentModel("gemini-3.1-pro"),
      "google-ai-studio/gemini-3.1-pro-preview",
    );
    assertEquals(
      resolveConfiguredAgentModel("gemini-3.5-flash"),
      "google-ai-studio/gemini-3.5-flash",
    );
    assertEquals(
      resolveConfiguredAgentModel("kimi-k2.6"),
      "moonshotai/kimi-k2.6",
    );
    assertEquals(
      resolveConfiguredAgentModel("mistral-large"),
      "mistral/mistral-large-2512",
    );
  });

  it("uses the default Veryfront Cloud model for auto runtime resolution", () => {
    setEnv("VERYFRONT_API_TOKEN", "vf_test_runtime");
    setEnv("VERYFRONT_PROJECT_SLUG", "demo-project");

    assertEquals(
      resolveRuntimeModel(),
      "veryfront-cloud/anthropic/claude-sonnet-4-6",
    );
  });

  it("uses direct OpenAI credentials for auto runtime resolution without cloud bootstrap", () => {
    setEnv("OPENAI_API_KEY", "sk-test");

    assertEquals(
      resolveRuntimeModel(),
      "openai/gpt-5.5",
    );
  });

  it("uses the configured default model when matching direct credentials are available", () => {
    setEnv("ANTHROPIC_API_KEY", "anthropic-test");
    setEnv("VERYFRONT_DEFAULT_MODEL", "anthropic/claude-opus-4-8");

    assertEquals(
      resolveRuntimeModel("auto"),
      "anthropic/claude-opus-4-8",
    );
  });

  it("prefers cloud bootstrap over direct provider defaults for auto runtime resolution", () => {
    setEnv("VERYFRONT_API_TOKEN", "vf_test_runtime");
    setEnv("VERYFRONT_PROJECT_SLUG", "demo-project");
    setEnv("OPENAI_API_KEY", "sk-test");

    assertEquals(
      resolveRuntimeModel(),
      "veryfront-cloud/anthropic/claude-sonnet-4-6",
    );
  });

  it("keeps explicit local runtime models explicit", () => {
    setEnv("VERYFRONT_API_TOKEN", "vf_test_runtime");
    setEnv("VERYFRONT_PROJECT_SLUG", "demo-project");

    assertEquals(
      resolveRuntimeModel("local/qwen3.5-0.8b"),
      "local/qwen3.5-0.8b",
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

  it("routes catalog Gemini, Mistral, and Kimi models through veryfront-cloud when only hosted bootstrap is available", () => {
    setEnv("VERYFRONT_API_TOKEN", "vf_test_runtime");
    setEnv("VERYFRONT_PROJECT_SLUG", "demo-project");

    assertEquals(
      resolveRuntimeModel("google-ai-studio/gemini-3.5-flash"),
      "veryfront-cloud/google-ai-studio/gemini-3.5-flash",
    );
    assertEquals(
      resolveRuntimeModel("moonshotai/kimi-k2.6"),
      "veryfront-cloud/moonshotai/kimi-k2.6",
    );
    assertEquals(
      resolveRuntimeModel("mistral/mistral-large-2512"),
      "veryfront-cloud/mistral/mistral-large-2512",
    );
    assertEquals(
      resolveRuntimeModel("mistral-large"),
      "veryfront-cloud/mistral/mistral-large-2512",
    );
    assertEquals(
      resolveRuntimeModel("mistral/mistral-small-2603"),
      "mistral/mistral-small-2603",
    );
    assertEquals(
      resolveRuntimeModel("mistral/mistral-medium-3-5"),
      "mistral/mistral-medium-3-5",
    );
    assertEquals(
      resolveRuntimeModel("kimi-k2.6"),
      "veryfront-cloud/moonshotai/kimi-k2.6",
    );
    assertEquals(
      resolveRuntimeModel("mistral-large"),
      "veryfront-cloud/mistral/mistral-large-2512",
    );
  });

  it("routes explicit Mistral models through the direct provider when native credentials are configured", () => {
    setEnv("VERYFRONT_API_TOKEN", "vf_test_runtime");
    setEnv("VERYFRONT_PROJECT_SLUG", "demo-project");
    setEnv("MISTRAL_API_KEY", "mistral-test");

    assertEquals(
      resolveRuntimeModel("mistral-large"),
      "mistral/mistral-large-2512",
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
      resolveRuntimeModel("google-ai-studio/gemini-3.5-flash"),
      "google/gemini-3.5-flash",
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

  it("rejects unsupported explicit veryfront-cloud Mistral models", () => {
    setEnv("VERYFRONT_API_TOKEN", "vf_test_runtime");
    setEnv("VERYFRONT_PROJECT_SLUG", "demo-project");

    assertThrows(
      () => resolveRuntimeModel("veryfront-cloud/mistral/mistral-small-2603"),
      Error,
      'Unsupported Mistral model "veryfront-cloud/mistral/mistral-small-2603"',
    );
    assertThrows(
      () => resolveRuntimeModel("veryfront-cloud/mistral/mistral-medium-3-5"),
      Error,
      'Unsupported Mistral model "veryfront-cloud/mistral/mistral-medium-3-5"',
    );
  });
});

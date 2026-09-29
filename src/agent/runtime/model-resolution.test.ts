import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertInstanceOf,
  assertStringIncludes,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { VeryfrontError } from "#veryfront/errors";
import { deleteEnv, setEnv } from "#veryfront/compat/process.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  seedServedCatalogForTests,
  SERVED_MODEL_ROWS,
  servedCatalogPayload,
  UNSERVED_MODEL_ROWS,
} from "#veryfront/provider/veryfront-cloud/catalog-client.test-helpers.ts";
import {
  __resetVeryfrontCloudCatalogForTests,
  __setVeryfrontCloudCatalogForTests,
} from "#veryfront/provider/veryfront-cloud/catalog-client.ts";
import { resolveVeryfrontCloudModelId } from "#veryfront/provider/veryfront-cloud/model-catalog.ts";
import { registerModelProvider } from "#veryfront/provider/model-registry.ts";
import {
  AUTO_AGENT_MODEL,
  DEFAULT_AGENT_MODEL,
  normalizeAgentModelConfig,
  resolveConfiguredAgentModel,
  resolveModelProviderOptionKey,
  resolveRuntimeModel,
} from "./model-resolution.ts";

/** Every model the served catalog fixtures list. */
const CATALOG_MODELS = [...SERVED_MODEL_ROWS, ...UNSERVED_MODEL_ROWS];

/** Seed the served fixtures plus one row per extra served model ID. */
function seedServedCatalogWith(...modelIds: string[]): void {
  const served = servedCatalogPayload();
  __setVeryfrontCloudCatalogForTests({
    ...served,
    models: [
      ...(served.models as unknown[]),
      ...modelIds.map((modelId) => {
        const [provider = "", id = ""] = modelId.split("/");
        return { id, modelId, provider, surface: "openai", aliases: [], capabilities: {} };
      }),
    ],
  });
}

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
  beforeEach(seedServedCatalogForTests);
  afterEach(__resetVeryfrontCloudCatalogForTests);
  afterEach(() => {
    clearModelEnv();
  });

  it("keeps the Cloud gateway for a defaulted model when a different provider key is present", () => {
    // Regression: an account holder who happens to have an Anthropic key must
    // keep routing the default model through the gateway. The
    // default-model mismatch error is only for the no-cloud case.
    setEnv("VERYFRONT_API_TOKEN", "vf-token");
    setEnv("VERYFRONT_SERVICE_LAYER", "cloud");
    setEnv("ANTHROPIC_API_KEY", "sk-ant-test");

    assertEquals(resolveRuntimeModel(), "veryfront-cloud/mistral/mistral-small-2503");
  });

  it("uses the hosted override for omitted models even with direct credentials", () => {
    setEnv("VERYFRONT_API_TOKEN", "vf-token");
    setEnv("VERYFRONT_SERVICE_LAYER", "cloud");
    setEnv("VERYFRONT_DEFAULT_MODEL", "anthropic/claude-sonnet-4-6");
    setEnv("OPENAI_API_KEY", "sk-test");
    assertEquals(resolveRuntimeModel(), "veryfront-cloud/anthropic/claude-sonnet-4-6");
  });

  it("keeps self-hosted auto provider precedence when OpenAI and Mistral keys exist", () => {
    setEnv("OPENAI_API_KEY", "sk-test");
    setEnv("MISTRAL_API_KEY", "mistral-test");
    assertEquals(resolveRuntimeModel("auto"), "openai/gpt-5-nano");
  });

  it("falls back to the direct Mistral default for auto resolution when only a Mistral key exists", () => {
    // Regression (#1898, CodeRabbit on #4609): the BYOK auto default must be a
    // model Mistral's own API still serves, never a gateway-retirement
    // decision. mistral-large-2512 (Mistral Large 3) is Mistral's current
    // flagship; mistral-small-2503 looks like a live gateway model (our
    // catalog still serves it) but Mistral itself deprecated it 2025-11-06
    // and retired it 2025-11-30, so it 404s on a direct call.
    setEnv("MISTRAL_API_KEY", "mistral-test");
    assertEquals(resolveRuntimeModel("auto"), "mistral/mistral-large-2512");
  });

  it("resolves the direct Mistral BYOK default without hitting the gateway's retired-model guard", () => {
    // mistral-large-2512 is on #4611's gateway retirement list
    // (isRetiredVeryfrontCloudModelId), because our own gateway no longer
    // serves it -- Mistral's own API still does. The direct/BYOK path in
    // resolveRuntimeModel must never consult that guard, so this must
    // resolve cleanly rather than throw NOT_SUPPORTED.
    setEnv("MISTRAL_API_KEY", "mistral-test");
    let result: string | undefined;
    try {
      result = resolveRuntimeModel("auto");
    } catch (error) {
      throw new Error(
        `expected the direct Mistral BYOK default to resolve without throwing, got: ${error}`,
      );
    }
    assertEquals(result, "mistral/mistral-large-2512");
  });

  it("resolves the direct OpenAI BYOK default without hitting the gateway's retired-model guard", () => {
    // Same shape as the Mistral case above, for the OpenAI BYOK default.
    // gpt-5-nano is not on the gateway retirement list, and OpenAI's own API
    // still serves it (https://developers.openai.com/api/docs/models/gpt-5-nano,
    // default snapshot gpt-5-nano-2025-08-07), so this is a same-behavior
    // check rather than a regression for a currently-broken path.
    setEnv("OPENAI_API_KEY", "sk-test");
    let result: string | undefined;
    try {
      result = resolveRuntimeModel("auto");
    } catch (error) {
      throw new Error(
        `expected the direct OpenAI BYOK default to resolve without throwing, got: ${error}`,
      );
    }
    assertEquals(result, "openai/gpt-5-nano");
  });

  it("reports a default-model mismatch when only another provider has a key", () => {
    setEnv("ANTHROPIC_API_KEY", "sk-ant-test");

    const err = assertThrows(() => resolveRuntimeModel(), VeryfrontError);
    assertInstanceOf(err, VeryfrontError, "the mismatch must be a VeryfrontError");
    assertEquals(err.slug, "default-model-credential-mismatch", err.message);
    assertEquals(err.status, 400, "the mismatch must stay a 400 client error");
    assertStringIncludes(err.message, "needs a openai credential", err.message);
    assertStringIncludes(err.message, "Found anthropic", err.message);
  });

  it("still routes the default model directly when its own provider has a key", () => {
    setEnv("OPENAI_API_KEY", "sk-openai-test");

    assertEquals(resolveRuntimeModel(), DEFAULT_AGENT_MODEL);
  });

  it("does not report a mismatch when no direct provider key exists at all", () => {
    // No credentials anywhere is a different, already-clear failure; this path
    // must stay untouched so the message does not change for those users.
    assertEquals(resolveRuntimeModel(), DEFAULT_AGENT_MODEL);
  });

  it("resolves the default agent model through Veryfront Cloud with no vendor key, without hitting NOT_SUPPORTED", () => {
    // Regression: on main, DEFAULT_AGENT_MODEL was still the gateway-retired
    // openai/gpt-5.4-nano while #4611's isRetiredVeryfrontCloudModelId guard
    // rejects gateway-retired ids. A hosted agent with no explicit model and
    // no direct vendor key falls through resolveConfiguredAgentModel() to
    // DEFAULT_AGENT_MODEL (see src/internal-agents/run-stream.ts), and that
    // value then reaches Veryfront Cloud's own resolver
    // (resolveVeryfrontCloudModelId) as an explicit "provider/model" string --
    // which used to throw NOT_SUPPORTED for every such run. It must not.
    let resolved: string | undefined;
    try {
      resolved = resolveVeryfrontCloudModelId(DEFAULT_AGENT_MODEL);
    } catch (error) {
      throw new Error(
        `expected the default agent model to resolve through Veryfront Cloud without throwing, got: ${error}`,
      );
    }
    assertEquals(resolved, DEFAULT_AGENT_MODEL);
  });

  it("does not report a mismatch for an explicitly configured model", () => {
    setEnv("ANTHROPIC_API_KEY", "sk-ant-test");

    assertEquals(resolveRuntimeModel("openai/gpt-5.5"), "openai/gpt-5.5");
  });

  it("normalizes omitted models to the default and blank models to auto", () => {
    assertEquals(normalizeAgentModelConfig(), DEFAULT_AGENT_MODEL);
    assertEquals(normalizeAgentModelConfig("   "), AUTO_AGENT_MODEL);
  });

  it("preserves explicit provider models", () => {
    assertEquals(
      normalizeAgentModelConfig("veryfront-cloud/anthropic/claude-sonnet-4-6"),
      "veryfront-cloud/anthropic/claude-sonnet-4-6",
    );
  });

  it("resolves omitted and auto model config separately", () => {
    assertEquals(
      resolveConfiguredAgentModel(),
      "openai/gpt-5-nano",
    );
    assertEquals(
      resolveConfiguredAgentModel("auto"),
      "veryfront-cloud/mistral/mistral-small-2503",
    );
  });

  it("passes explicit models through unchanged", () => {
    assertEquals(
      resolveConfiguredAgentModel("openai/gpt-4o"),
      "openai/gpt-4o",
    );
  });

  it("preserves case-sensitive provider-options keys", () => {
    assertEquals(
      resolveModelProviderOptionKey("AWS-Anthropic/claude-sonnet"),
      "AWS-Anthropic",
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
      resolveConfiguredAgentModel("gemini-3.5-flash"),
      "google-ai-studio/gemini-3.5-flash",
    );
    assertEquals(
      resolveConfiguredAgentModel("kimi-k2.6"),
      "moonshotai/kimi-k2.6",
    );
    assertEquals(
      resolveConfiguredAgentModel("mistral-small-2503"),
      "mistral/mistral-small-2503",
    );
  });

  it("keeps bare aliases of gateway-retired models for direct provider keys", () => {
    assertEquals(resolveConfiguredAgentModel("gpt-5.4-nano"), "openai/gpt-5.4-nano");
    assertEquals(
      resolveConfiguredAgentModel("gemini-3.1-pro"),
      "google-ai-studio/gemini-3.1-pro-preview",
    );
    assertEquals(
      resolveConfiguredAgentModel("gemini-3.1-pro-preview"),
      "google-ai-studio/gemini-3.1-pro-preview",
    );
    assertEquals(resolveConfiguredAgentModel("mistral-large"), "mistral/mistral-large-2512");
    assertEquals(
      resolveConfiguredAgentModel("mistral-large-2512"),
      "mistral/mistral-large-2512",
    );
  });

  it("calls gateway-retired models directly when the vendor key is configured", () => {
    clearModelEnv();
    setEnv("VERYFRONT_API_TOKEN", "vf_test_runtime");
    setEnv("VERYFRONT_PROJECT_SLUG", "demo-project");
    setEnv("OPENAI_API_KEY", "sk-test");
    setEnv("GOOGLE_API_KEY", "google-test");
    setEnv("MISTRAL_API_KEY", "mistral-test");

    assertEquals(resolveRuntimeModel("gpt-5.4-nano"), "openai/gpt-5.4-nano");
    assertEquals(resolveRuntimeModel("gemini-3.1-pro"), "google/gemini-3.1-pro-preview");
    assertEquals(resolveRuntimeModel("mistral-large"), "mistral/mistral-large-2512");
  });

  it("rejects gateway-retired models instead of routing them through Veryfront Cloud", () => {
    clearModelEnv();
    setEnv("VERYFRONT_API_TOKEN", "vf_test_runtime");
    setEnv("VERYFRONT_PROJECT_SLUG", "demo-project");

    for (
      const model of [
        "gpt-5.4-nano",
        "openai/gpt-5.4-nano",
        "veryfront-cloud/openai/gpt-5.4-nano",
        "gemini-3.1-pro",
        "google/gemini-3.1-pro-preview",
        "veryfront-cloud/google-ai-studio/gemini-3.1-pro-preview",
      ]
    ) {
      assertThrows(
        () => resolveRuntimeModel(model),
        Error,
        "is no longer available through Veryfront Cloud",
      );
    }
    assertThrows(
      () => resolveRuntimeModel("veryfront-cloud/mistral/mistral-large-2512"),
      Error,
      'Unsupported Mistral model "veryfront-cloud/mistral/mistral-large-2512"',
    );
  });

  it("aliases every Veryfront Cloud catalog model id to its provider model", () => {
    for (const model of CATALOG_MODELS) {
      assertEquals(resolveConfiguredAgentModel(model.id), model.modelId);
    }
  });

  it("routes every catalog identity through Cloud when no direct credentials exist", () => {
    clearModelEnv();
    setEnv("VERYFRONT_API_TOKEN", "vf_test_runtime");
    setEnv("VERYFRONT_PROJECT_SLUG", "demo-project");
    for (const model of CATALOG_MODELS) {
      const hosted = `veryfront-cloud/${model.modelId}`;
      assertEquals(resolveRuntimeModel(model.id), hosted);
      assertEquals(resolveRuntimeModel(model.modelId), hosted);
      assertEquals(resolveRuntimeModel(hosted), hosted);
    }
  });

  it("does not resolve Object.prototype members as model aliases", () => {
    for (
      const inherited of [
        "constructor",
        "toString",
        "valueOf",
        "hasOwnProperty",
        "isPrototypeOf",
        "propertyIsEnumerable",
        "toLocaleString",
        "__proto__",
        "__defineGetter__",
        "__defineSetter__",
        "__lookupGetter__",
        "__lookupSetter__",
      ]
    ) {
      assertEquals(resolveConfiguredAgentModel(inherited), inherited);
    }
  });

  it("uses the default model through Veryfront Cloud when cloud bootstrap is available", () => {
    setEnv("VERYFRONT_API_TOKEN", "vf_test_runtime");
    setEnv("VERYFRONT_PROJECT_SLUG", "demo-project");

    assertEquals(
      resolveRuntimeModel(),
      "veryfront-cloud/mistral/mistral-small-2503",
    );
  });

  it("uses direct OpenAI credentials for omitted model resolution without cloud bootstrap", () => {
    setEnv("OPENAI_API_KEY", "sk-test");

    assertEquals(
      resolveRuntimeModel(),
      "openai/gpt-5-nano",
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
      resolveRuntimeModel("auto"),
      "veryfront-cloud/mistral/mistral-small-2503",
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

  it("routes every catalog provider through veryfront-cloud when only hosted bootstrap is available", () => {
    setEnv("VERYFRONT_API_TOKEN", "vf_test_runtime");
    setEnv("VERYFRONT_PROJECT_SLUG", "demo-project");

    const providers = new Set(
      CATALOG_MODELS.flatMap((model) => [model.provider, model.modelId.split("/")[0] ?? ""]),
    );
    for (const provider of providers) {
      // Mistral model IDs are gated by the catalog, so it needs a listed one.
      const modelId = provider === "mistral" ? "mistral-small-2503" : "model-x";
      assertEquals(
        resolveRuntimeModel(`${provider}/${modelId}`),
        `veryfront-cloud/${provider}/${modelId}`,
        provider,
      );
    }
  });

  it("routes every vendor the gateway catalog serves through veryfront-cloud (#1913)", () => {
    // The vendors GET /ai/models lists. A vendor missing here fails hosted
    // runs with `Model provider "<vendor>" not registered`.
    seedServedCatalogWith("deepseek/deepseek-v4-flash", "qwen/qwen3.8-27b");
    setEnv("VERYFRONT_API_TOKEN", "vf_test_runtime");
    setEnv("VERYFRONT_PROJECT_SLUG", "demo-project");

    assertEquals(
      [
        "anthropic/claude-sonnet-4-6",
        "openai/gpt-5-nano",
        "google/gemini-3.5-flash",
        "mistral/mistral-small-2503",
        "deepseek/deepseek-v4-flash",
        "qwen/qwen3.8-27b",
      ].map((model) => resolveRuntimeModel(model)),
      [
        "veryfront-cloud/anthropic/claude-sonnet-4-6",
        "veryfront-cloud/openai/gpt-5-nano",
        "veryfront-cloud/google/gemini-3.5-flash",
        "veryfront-cloud/mistral/mistral-small-2503",
        "veryfront-cloud/deepseek/deepseek-v4-flash",
        "veryfront-cloud/qwen/qwen3.8-27b",
      ],
    );
  });

  it("keeps a gateway-only provider unrouted without hosted bootstrap", () => {
    setEnv("OPENAI_API_KEY", "sk-test");
    assertEquals(resolveRuntimeModel("qwen/qwen3.8-27b"), "qwen/qwen3.8-27b");
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
      "mistral/mistral-large-2512",
    );
    assertEquals(
      resolveRuntimeModel("mistral-small-2503"),
      "veryfront-cloud/mistral/mistral-small-2503",
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

describe("agent/runtime/model-resolution hosted candidates", () => {
  beforeEach(() => {
    __resetVeryfrontCloudCatalogForTests();
    setEnv("VERYFRONT_API_TOKEN", "vf_test_runtime");
    setEnv("VERYFRONT_PROJECT_SLUG", "demo-project");
  });
  afterEach(__resetVeryfrontCloudCatalogForTests);
  afterEach(() => {
    clearModelEnv();
  });

  it("routes any well-formed provider through veryfront-cloud before a catalog loads", () => {
    // No list to check against, so no provider is refused: a provider the
    // platform added (the zai regression) reaches the gateway.
    for (
      const model of [
        "zai/glm-5.2",
        "qwen/qwen3.8-27b",
        "deepseek/deepseek-v4-flash",
        "moonshotai/kimi-k2.6",
        "acme-labs/mystery-1",
        "mistral/mistral-small-2603",
        "anthropic/claude-sonnet-4-6",
      ]
    ) {
      assertEquals(resolveRuntimeModel(model), `veryfront-cloud/${model}`, model);
    }
    assertEquals(
      resolveRuntimeModel("veryfront-cloud/mistral/mistral-small-2603"),
      "veryfront-cloud/mistral/mistral-small-2603",
    );
  });

  it("keeps the fixed agent model aliases before a catalog loads", () => {
    assertEquals(resolveConfiguredAgentModel("sonnet"), "anthropic/claude-sonnet-4-6");
    assertEquals(resolveConfiguredAgentModel("opus"), "anthropic/claude-opus-4-8");
    assertEquals(resolveConfiguredAgentModel("gpt-5.5"), "openai/gpt-5.5");
    assertEquals(resolveRuntimeModel("sonnet"), "veryfront-cloud/anthropic/claude-sonnet-4-6");
    assertThrows(() => resolveVeryfrontCloudModelId("sonnet"), Error, "Unknown model alias");
  });

  it("still refuses gateway-retired models before a catalog loads", () => {
    for (
      const model of [
        "openai/gpt-5.4-nano",
        "google/gemini-3.1-pro-preview",
        "mistral/mistral-large-2512",
        "veryfront-cloud/mistral/mistral-large-2512",
      ]
    ) {
      assertThrows(
        () => resolveRuntimeModel(model),
        Error,
        "is no longer available through Veryfront Cloud",
      );
    }
  });

  it("keeps a provider the application registered on its own runtime, before and after a catalog loads", () => {
    // `zai` is one the served catalog lists below: the application's own
    // runtime must still win, so routing does not change when the catalog loads.
    const unregister = registerModelProvider("zai", () => {
      throw new Error("not resolved in this test");
    });
    try {
      assertEquals(resolveRuntimeModel("zai/glm-5.2"), "zai/glm-5.2");
      seedServedCatalogWith("zai/glm-5.2");
      assertEquals(resolveRuntimeModel("zai/glm-5.2"), "zai/glm-5.2");
      assertEquals(resolveRuntimeModel("zai/glm-9"), "zai/glm-9");
    } finally {
      unregister();
    }
    // Without the registration the same fresh catalog routes it to the gateway.
    assertEquals(resolveRuntimeModel("zai/glm-5.2"), "veryfront-cloud/zai/glm-5.2");
  });

  it("keeps an ill-formed provider segment off the gateway before a catalog loads", () => {
    assertEquals(resolveRuntimeModel("Acme Labs/mystery-1"), "Acme Labs/mystery-1");
    assertEquals(resolveRuntimeModel("constructor/mystery-1"), "constructor/mystery-1");
  });

  it("routes only providers a fresh served catalog serves or lists", () => {
    seedServedCatalogWith("zai/glm-5.2");
    assertEquals(resolveRuntimeModel("zai/glm-5.2"), "veryfront-cloud/zai/glm-5.2");
    assertEquals(resolveRuntimeModel("zai/glm-9"), "veryfront-cloud/zai/glm-9");
    assertEquals(
      resolveRuntimeModel("moonshotai/kimi-k2.6"),
      "veryfront-cloud/moonshotai/kimi-k2.6",
    );
    assertEquals(resolveRuntimeModel("acme-labs/mystery-1"), "acme-labs/mystery-1");
    // Providers this package can call directly stay candidates whatever the catalog says.
    assertEquals(
      resolveRuntimeModel("openai/gpt-unlisted"),
      "veryfront-cloud/openai/gpt-unlisted",
    );
  });
});

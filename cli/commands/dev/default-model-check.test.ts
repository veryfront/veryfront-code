import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { DEFAULT_MODEL_CREDENTIAL_MISMATCH, INVALID_ARGUMENT } from "veryfront/errors";
import { agentRegistry } from "#veryfront/agent/composition/index.ts";
import { agent } from "#veryfront/agent/factory.ts";
import { deleteEnv, getEnv, setEnv } from "#veryfront/compat/process.ts";
import { registerModelProvider } from "#veryfront/provider/model-registry.ts";
import {
  autoRunsDirectHere,
  defaultModelMismatchWarning,
  defaultModelRunsHere,
  registeredAgentModels,
} from "./default-model-check.ts";
import { defaultModelMismatchKeys, readProviderKeys } from "./inference-status.ts";

function failsWith(error: Error): (model?: string) => string {
  return () => {
    throw error;
  };
}

describe("dev default-model check", () => {
  describe("defaultModelRunsHere", () => {
    it("is false when the runtime reports a default-model credential mismatch", () => {
      const mismatch = DEFAULT_MODEL_CREDENTIAL_MISMATCH.create({ detail: "needs openai" });
      assertEquals(defaultModelRunsHere(failsWith(mismatch)), false);
    });

    it("is true when the runtime resolves the default model", () => {
      assertEquals(defaultModelRunsHere(() => "openai/gpt-5-nano"), true);
    });

    it("leaves any other resolution failure to the request that meets it", () => {
      assertEquals(defaultModelRunsHere(failsWith(INVALID_ARGUMENT.create({}))), true);
      assertEquals(defaultModelRunsHere(failsWith(new Error("catalog unavailable"))), true);
    });
  });

  describe("autoRunsDirectHere", () => {
    it("is true when auto resolves to a provider directly", () => {
      assertEquals(autoRunsDirectHere(() => "openai/gpt-5-nano"), true);
    });

    it("is false when auto resolves to the Veryfront Cloud gateway", () => {
      assertEquals(autoRunsDirectHere(() => "veryfront-cloud/mistral/mistral-small-2503"), false);
    });

    it("is false when auto does not resolve", () => {
      assertEquals(autoRunsDirectHere(failsWith(new Error("no model"))), false);
    });
  });

  describe("registeredAgentModels", () => {
    afterEach(() => agentRegistry.clearAll());

    it("lists each agent's own model and leaves an omitted one undefined", () => {
      agentRegistry.clearAll();
      agentRegistry.register(
        "picks-a-model",
        agent({ id: "picks-a-model", model: "anthropic/claude-sonnet-4-6", system: "Help." }),
      );
      agentRegistry.register(
        "uses-the-default",
        agent({ id: "uses-the-default", system: "Help." }),
      );

      assertEquals(registeredAgentModels().sort(), ["anthropic/claude-sonnet-4-6", undefined]);
    });
  });

  describe("defaultModelMismatchWarning", () => {
    const environment = { anthropicApiKey: "sk-ant-test", agentModels: [undefined] };

    it("names the keys the default model cannot use, and offers auto when it runs direct", () => {
      assertEquals(
        defaultModelMismatchWarning(environment, {
          defaultModelRuns: () => false,
          autoRunsDirect: () => true,
        }),
        'Agents that set no model use "openai/gpt-5-nano", which needs OPENAI_API_KEY. To use ANTHROPIC_API_KEY, set the agent\'s model to "auto" or "<provider>/<model>".',
      );
    });

    it("says nothing when the default model runs here", () => {
      assertEquals(
        defaultModelMismatchWarning(environment, {
          defaultModelRuns: () => true,
          autoRunsDirect: () => true,
        }),
        undefined,
      );
    });
  });
});

describe("dev default-model check against the runtime", () => {
  // The banner asks the runtime whether an agent with no model runs here, so
  // each case sets the real environment the runtime reads.
  const MODEL_ENV = [
    "ANTHROPIC_API_KEY",
    "GOOGLE_API_KEY",
    "GOOGLE_GENERATIVE_AI_API_KEY",
    "MISTRAL_API_KEY",
    "OPENAI_API_KEY",
    "OPENAI_BASE_URL",
    "VERYFRONT_API_TOKEN",
    "VERYFRONT_DEFAULT_MODEL",
    "VERYFRONT_PROJECT_SLUG",
    "VERYFRONT_SERVICE_LAYER",
  ] as const;
  const saved = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const name of MODEL_ENV) {
      saved.set(name, getEnv(name));
      deleteEnv(name);
    }
  });
  afterEach(() => {
    for (const [name, value] of saved) {
      if (value === undefined) deleteEnv(name);
      else setEnv(name, value);
    }
    saved.clear();
  });

  /** The keys the banner warns about, as `devCommand` reads them. */
  function bannerKeys(env: Record<string, string>, agentModels: (string | undefined)[]) {
    for (const [name, value] of Object.entries(env)) setEnv(name, value);
    return defaultModelMismatchKeys(
      { ...readProviderKeys(getEnv), agentModels },
      defaultModelRunsHere(),
    );
  }

  const KEY = "<API_KEY>";
  const CLOUD = { VERYFRONT_API_TOKEN: "<TOKEN>", VERYFRONT_PROJECT_SLUG: "<PROJECT_ID>" };
  const cases: Array<[string, Record<string, string>, string[]]> = [
    ["no key at all", {}, []],
    ["an OpenAI key", { OPENAI_API_KEY: KEY }, []],
    ["only an Anthropic key", { ANTHROPIC_API_KEY: KEY }, ["ANTHROPIC_API_KEY"]],
    ["only GOOGLE_API_KEY", { GOOGLE_API_KEY: KEY }, ["GOOGLE_API_KEY"]],
    [
      "only GOOGLE_GENERATIVE_AI_API_KEY",
      { GOOGLE_GENERATIVE_AI_API_KEY: KEY },
      ["GOOGLE_GENERATIVE_AI_API_KEY"],
    ],
    ["only a Mistral key", { MISTRAL_API_KEY: KEY }, ["MISTRAL_API_KEY"]],
    [
      "Anthropic, Google and Mistral keys",
      { ANTHROPIC_API_KEY: KEY, GOOGLE_API_KEY: KEY, MISTRAL_API_KEY: KEY },
      ["ANTHROPIC_API_KEY", "GOOGLE_API_KEY", "MISTRAL_API_KEY"],
    ],
    ["OpenAI and Anthropic keys", { OPENAI_API_KEY: KEY, ANTHROPIC_API_KEY: KEY }, []],
    [
      "an OpenAI endpoint without an OpenAI key",
      { OPENAI_BASE_URL: "http://127.0.0.1:11434/v1", ANTHROPIC_API_KEY: KEY },
      ["ANTHROPIC_API_KEY"],
    ],
    ["Cloud with an Anthropic key", { ...CLOUD, ANTHROPIC_API_KEY: KEY }, []],
    [
      "Cloud forced off with an Anthropic key",
      { ...CLOUD, VERYFRONT_SERVICE_LAYER: "local", ANTHROPIC_API_KEY: KEY },
      ["ANTHROPIC_API_KEY"],
    ],
  ];

  for (const [label, env, expected] of cases) {
    it(`names ${expected.length ? expected.join(", ") : "no key"} for ${label}`, () => {
      assertEquals(bannerKeys(env, [undefined]), expected);
    });
  }

  it("names no key when every agent sets a model, whatever the keys", () => {
    assertEquals(
      bannerKeys({ ANTHROPIC_API_KEY: KEY }, ["anthropic/claude-sonnet-4-6", "auto"]),
      [],
    );
  });

  it("names no key when the application registers its own openai provider", () => {
    const unregister = registerModelProvider("openai", () => {
      throw new Error("not resolved in this test");
    });
    try {
      assertEquals(bannerKeys({ ANTHROPIC_API_KEY: KEY }, [undefined]), []);
    } finally {
      unregister();
    }
  });

  it('offers "auto" only when it resolves to direct inference', () => {
    setEnv("ANTHROPIC_API_KEY", KEY);
    assertEquals(autoRunsDirectHere(), true);
    for (const [name, value] of Object.entries(CLOUD)) setEnv(name, value);
    // With Veryfront Cloud selected, "auto" prefers the gateway.
    assertEquals(autoRunsDirectHere(), false);
  });

  it('does not offer "auto" when it reaches no model directly', () => {
    assertEquals(autoRunsDirectHere(), false);
  });
});

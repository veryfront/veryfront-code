import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  advertisesCloudGateway,
  defaultModelMismatchKeys,
  devInferenceHintLines,
  hasUsableInference,
  listInferenceOptions,
  readProviderKeys,
} from "./inference-status.ts";
import {
  defaultModelKeyMismatchLine,
  DEV_ENV_RESTART_LINE,
  inferenceSetupOptionLines,
  NO_INFERENCE_HEADING,
} from "../../shared/inference-setup.ts";

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

  it("reports actionable project setup when a logged-in project is not linked yet", () => {
    assertEquals(
      listInferenceOptions({ apiToken: "<TOKEN>" }),
      [
        "Cloud (no project connected)",
      ],
    );
  });

  it("reports nothing when no credential can reach any provider", () => {
    assertEquals(listInferenceOptions({}), []);
    assertEquals(listInferenceOptions({ projectSlug: "support-agent" }), []);
  });

  it("flags option lists that claim the gateway, so callers can validate the session", () => {
    // The banner cannot block Ready on a network round-trip, so dev uses this
    // to decide whether the already-running session check is worth reporting.
    assertEquals(advertisesCloudGateway(listInferenceOptions({ apiToken: "<TOKEN>" })), true);
    assertEquals(
      advertisesCloudGateway(listInferenceOptions({ openaiApiKey: "<API_KEY>" })),
      false,
    );
    assertEquals(advertisesCloudGateway(listInferenceOptions({})), false);
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

  it("counts only options that can serve a model as usable inference", () => {
    // A stored login without a linked project is listed, so the reader sees the
    // missing setup, but the gateway refuses model requests without a project.
    assertEquals(hasUsableInference(listInferenceOptions({ apiToken: "<TOKEN>" })), false);
    assertEquals(hasUsableInference(listInferenceOptions({})), false);
    assertEquals(
      hasUsableInference(listInferenceOptions({ apiToken: "<TOKEN>", projectSlug: "app" })),
      true,
    );
    assertEquals(hasUsableInference(listInferenceOptions({ openaiApiKey: "<API_KEY>" })), true);
    assertEquals(
      hasUsableInference(
        listInferenceOptions({ apiToken: "<TOKEN>", anthropicApiKey: "<API_KEY>" }),
      ),
      true,
    );
  });

  it("prints no setup hint when an option can serve a model", () => {
    assertEquals(devInferenceHintLines(listInferenceOptions({ openaiApiKey: "<API_KEY>" })), []);
    assertEquals(
      devInferenceHintLines(listInferenceOptions({ apiToken: "<TOKEN>", projectSlug: "app" })),
      [],
    );
  });

  it("prints the heading, both options, and the restart line when none can", () => {
    const expected = [NO_INFERENCE_HEADING, ...inferenceSetupOptionLines(), DEV_ENV_RESTART_LINE];
    assertEquals(devInferenceHintLines(listInferenceOptions({})), expected);
    // A stored login without a linked project cannot serve a model either.
    assertEquals(devInferenceHintLines(listInferenceOptions({ apiToken: "<TOKEN>" })), expected);
  });

  describe("agents that leave their model unset", () => {
    // An agent with no model runs openai/gpt-5-nano. Without the gateway, an
    // OpenAI key, or an application openai provider, its default request fails
    // with default-model-credential-mismatch.
    const anthropicOnly = { anthropicApiKey: "<API_KEY>", agentModels: [undefined, undefined] };

    it("names a key the default model cannot use", () => {
      assertEquals(defaultModelMismatchKeys(anthropicOnly), ["ANTHROPIC_API_KEY"]);
      assertEquals(
        defaultModelMismatchKeys({
          googleApiKey: "<API_KEY>",
          mistralApiKey: "<API_KEY>",
          agentModels: [undefined],
        }),
        ["GOOGLE_API_KEY", "MISTRAL_API_KEY"],
      );
      assertEquals(
        defaultModelKeyMismatchLine(["ANTHROPIC_API_KEY"]),
        'Agents that set no model use "openai/gpt-5-nano", which needs OPENAI_API_KEY. To use ANTHROPIC_API_KEY, set the agent\'s model to "auto" or "<provider>/<model>".',
      );
    });

    it("still lists the key, because a request can pick a model of its provider", () => {
      // AgentStreamInput.model and the AG-UI body accept a per-request model.
      assertEquals(listInferenceOptions(anthropicOnly), ["Anthropic direct"]);
      assertEquals(devInferenceHintLines(listInferenceOptions(anthropicOnly)), []);
    });

    it("names nothing when every agent sets a model or auto", () => {
      for (const model of ["anthropic/claude-sonnet-4-6", "auto", ""]) {
        assertEquals(
          defaultModelMismatchKeys({ anthropicApiKey: "<API_KEY>", agentModels: [model, model] }),
          [],
        );
      }
    });

    it("names the key when one agent sets no model beside one that does", () => {
      // The configured sibling does not make the omitted agent runnable.
      assertEquals(
        defaultModelMismatchKeys({
          anthropicApiKey: "<API_KEY>",
          agentModels: ["anthropic/claude-sonnet-4-6", undefined],
        }),
        ["ANTHROPIC_API_KEY"],
      );
    });

    it("names nothing when the default model can run", () => {
      for (
        const environment of [
          { ...anthropicOnly, openaiApiKey: "<API_KEY>" },
          { ...anthropicOnly, apiToken: "<TOKEN>", projectSlug: "support-agent" },
          { ...anthropicOnly, defaultModelProviderRegistered: true },
        ]
      ) {
        assertEquals(defaultModelMismatchKeys(environment), []);
      }
    });

    it("names nothing when the agents are not known", () => {
      for (const agentModels of [undefined, []]) {
        assertEquals(defaultModelMismatchKeys({ anthropicApiKey: "<API_KEY>", agentModels }), []);
      }
    });

    it("names the Google variable that is actually set", () => {
      const read = (values: Record<string, string>) => (name: string) => values[name];
      const generative = readProviderKeys(read({ GOOGLE_GENERATIVE_AI_API_KEY: "<API_KEY>" }));
      assertEquals(generative.googleApiKeyName, "GOOGLE_GENERATIVE_AI_API_KEY");
      assertEquals(
        defaultModelMismatchKeys({ ...generative, agentModels: [undefined] }),
        ["GOOGLE_GENERATIVE_AI_API_KEY"],
      );
      // The runtime reads GOOGLE_API_KEY first, and skips an empty one.
      assertEquals(
        readProviderKeys(read({ GOOGLE_API_KEY: "<API_KEY>", GOOGLE_GENERATIVE_AI_API_KEY: "x" }))
          .googleApiKeyName,
        "GOOGLE_API_KEY",
      );
      assertEquals(
        readProviderKeys(read({ GOOGLE_API_KEY: "", GOOGLE_GENERATIVE_AI_API_KEY: "<API_KEY>" }))
          .googleApiKeyName,
        "GOOGLE_GENERATIVE_AI_API_KEY",
      );
      assertEquals(readProviderKeys(read({})).googleApiKey, undefined);
    });
  });
});

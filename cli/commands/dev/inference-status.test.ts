import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  advertisesCloudGateway,
  devInferenceHintLines,
  hasUsableInference,
  listInferenceOptions,
  providerKeysNoAgentCanUse,
} from "./inference-status.ts";
import {
  DEV_ENV_RESTART_LINE,
  inferenceSetupOptionLines,
  NO_INFERENCE_HEADING,
  unusedProviderKeyHeading,
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
    // An agent with no model runs openai/gpt-5-nano. Without the gateway or an
    // OpenAI key, its first request fails with default-model-credential-mismatch,
    // so another provider's key serves none of these agents.
    const anthropicOnly = { anthropicApiKey: "<API_KEY>", agentModels: [undefined, undefined] };

    it("does not report a key that no agent can use", () => {
      assertEquals(providerKeysNoAgentCanUse(anthropicOnly), ["ANTHROPIC_API_KEY"]);
      assertEquals(listInferenceOptions(anthropicOnly), []);
      assertEquals(hasUsableInference(listInferenceOptions(anthropicOnly)), false);
      assertEquals(
        providerKeysNoAgentCanUse({
          googleApiKey: "<API_KEY>",
          mistralApiKey: "<API_KEY>",
          agentModels: [undefined],
        }),
        ["GOOGLE_API_KEY", "MISTRAL_API_KEY"],
      );
    });

    it("names the unused key and the default model's key in the hint", () => {
      assertEquals(
        devInferenceHintLines(
          listInferenceOptions(anthropicOnly),
          providerKeysNoAgentCanUse(anthropicOnly),
        ),
        [
          unusedProviderKeyHeading(["ANTHROPIC_API_KEY"]),
          ...inferenceSetupOptionLines(),
          DEV_ENV_RESTART_LINE,
        ],
      );
      assertEquals(
        unusedProviderKeyHeading(["ANTHROPIC_API_KEY"]),
        'ANTHROPIC_API_KEY is set, but your agents set no model, so they use the default "openai/gpt-5-nano", which needs OPENAI_API_KEY. To use hosted models, choose one:',
      );
      assertEquals(
        unusedProviderKeyHeading(["GOOGLE_API_KEY", "MISTRAL_API_KEY"]).startsWith(
          "GOOGLE_API_KEY and MISTRAL_API_KEY are set, but",
        ),
        true,
      );
    });

    it("keeps the key when an agent sets a model or auto", () => {
      for (const model of ["anthropic/claude-sonnet-4-6", "auto", ""]) {
        const environment = { anthropicApiKey: "<API_KEY>", agentModels: [undefined, model] };
        assertEquals(providerKeysNoAgentCanUse(environment), []);
        assertEquals(listInferenceOptions(environment), ["Anthropic direct"]);
      }
    });

    it("keeps the key when the default model can run", () => {
      for (
        const environment of [
          { ...anthropicOnly, openaiApiKey: "<API_KEY>" },
          { ...anthropicOnly, apiToken: "<TOKEN>", projectSlug: "support-agent" },
        ]
      ) {
        assertEquals(providerKeysNoAgentCanUse(environment), []);
        assertEquals(listInferenceOptions(environment).includes("Anthropic direct"), true);
      }
    });

    it("keeps the key when the agents are not known", () => {
      for (const agentModels of [undefined, []]) {
        const environment = { anthropicApiKey: "<API_KEY>", agentModels };
        assertEquals(providerKeysNoAgentCanUse(environment), []);
        assertEquals(listInferenceOptions(environment), ["Anthropic direct"]);
      }
    });
  });
});

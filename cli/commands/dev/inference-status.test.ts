import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  advertisesCloudGateway,
  devInferenceHintLines,
  hasUsableInference,
  listInferenceOptions,
} from "./inference-status.ts";
import {
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
});

import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { DEFAULT_MODEL_CREDENTIAL_MISMATCH, INVALID_ARGUMENT } from "veryfront/errors";
import { agentRegistry } from "#veryfront/agent/composition/index.ts";
import { agent } from "#veryfront/agent/factory.ts";
import {
  autoRunsDirectHere,
  defaultModelMismatchWarning,
  defaultModelRunsHere,
  registeredAgentModels,
} from "./default-model-check.ts";

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

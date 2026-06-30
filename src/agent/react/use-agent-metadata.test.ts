import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getAgentPromptSuggestions, normalizeAgentMetadataResponse } from "./use-agent-metadata.ts";

describe("agent/react/use-agent-metadata", () => {
  it("normalizes browser-safe agent metadata", () => {
    const agent = normalizeAgentMetadataResponse({
      agent: {
        id: "support-agent",
        name: "Support Agent",
        description: "Customer operations assistant",
        avatar_url: "https://cdn.example.com/support.svg",
        suggestions: {
          welcomeMessage: "What should we triage?",
          suggestions: [
            {
              type: "prompt",
              title: "Triage login issue",
              prompt: "Triage a customer who cannot sign in.",
            },
            {
              type: "task",
              id: "daily-triage",
            },
          ],
        },
      },
    });

    assertEquals(agent, {
      id: "support-agent",
      name: "Support Agent",
      description: "Customer operations assistant",
      avatarUrl: "https://cdn.example.com/support.svg",
      suggestions: {
        welcomeMessage: "What should we triage?",
        suggestions: [
          {
            type: "prompt",
            title: "Triage login issue",
            prompt: "Triage a customer who cannot sign in.",
          },
          {
            type: "task",
            id: "daily-triage",
          },
        ],
      },
    });
    assertEquals(getAgentPromptSuggestions(agent), ["Triage a customer who cannot sign in."]);
  });

  it("rejects malformed responses", async () => {
    await assertRejects(
      async () => {
        normalizeAgentMetadataResponse({ agent: { id: "support-agent" } });
      },
      Error,
      "name is required",
    );
  });
});

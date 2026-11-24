import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  getAgentPromptSuggestionItems,
  getAgentPromptSuggestions,
  normalizeAgentMetadataResponse,
} from "./use-agent-metadata.ts";

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

  it("renders a resolved prompt reference and skips a bare one", () => {
    const agent = normalizeAgentMetadataResponse({
      agent: {
        id: "support-agent",
        name: "Support Agent",
        suggestions: {
          suggestions: [
            {
              type: "prompt",
              id: "triage-ticket",
              title: "Triage a ticket",
              prompt: "Triage the newest open ticket.",
            },
            { type: "prompt", id: "older-server-reference" },
            { type: "prompt", title: "Plan work", prompt: "Plan the next sprint." },
          ],
        },
      },
    });

    assertEquals(agent.suggestions?.suggestions, [
      {
        id: "triage-ticket",
        type: "prompt",
        title: "Triage a ticket",
        prompt: "Triage the newest open ticket.",
      },
      { id: "older-server-reference", type: "prompt" },
      { type: "prompt", title: "Plan work", prompt: "Plan the next sprint." },
    ]);
    assertEquals(getAgentPromptSuggestions(agent), [
      "Triage the newest open ticket.",
      "Plan the next sprint.",
    ]);
    assertEquals(getAgentPromptSuggestionItems(agent), [
      { label: "Triage a ticket", prompt: "Triage the newest open ticket." },
      { label: "Plan work", prompt: "Plan the next sprint." },
    ]);
  });

  it("rejects malformed agent suggestions", () => {
    assertThrows(
      () => normalizeAgentMetadataResponse({ agent: { id: "a", name: "A", suggestions: "nope" } }),
      Error,
      "suggestions must be an object",
      "a non-object suggestions group is rejected",
    );
    assertThrows(
      () =>
        normalizeAgentMetadataResponse({
          agent: { id: "a", name: "A", suggestions: { suggestions: "nope" } },
        }),
      Error,
      "suggestions must be an array",
      "a non-array suggestions list is rejected",
    );
    assertThrows(
      () =>
        normalizeAgentMetadataResponse({
          agent: { id: "a", name: "A", suggestions: { suggestions: [{ type: "weird" }] } },
        }),
      Error,
      "unsupported suggestion type",
      "an unknown suggestion type is rejected",
    );
    assertThrows(
      () =>
        normalizeAgentMetadataResponse({
          agent: {
            id: "a",
            name: "A",
            suggestions: { suggestions: [{ type: "prompt", title: "T" }] },
          },
        }),
      Error,
      "prompt is required",
      "a prompt suggestion without prompt text is rejected",
    );
  });

  it("drops a blank welcome message", () => {
    const agent = normalizeAgentMetadataResponse({
      agent: {
        id: "a",
        name: "A",
        suggestions: {
          welcomeMessage: "   ",
          suggestions: [{ type: "task", id: "t" }],
        },
      },
    });

    assertEquals(
      agent.suggestions,
      { suggestions: [{ type: "task", id: "t" }] },
      "a whitespace-only welcomeMessage is dropped",
    );
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

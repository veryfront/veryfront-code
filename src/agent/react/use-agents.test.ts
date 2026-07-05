import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { normalizeAgentsListResponse } from "./use-agents.ts";

describe("agent/react/use-agents", () => {
  it("normalizes a list of browser-safe agents", () => {
    const agents = normalizeAgentsListResponse({
      agents: [
        {
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
              { type: "task", id: "daily-triage" },
            ],
          },
        },
        {
          id: "sales-agent",
          name: "Sales Agent",
          description: null,
        },
      ],
    });

    assertEquals(agents, [
      {
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
            { type: "task", id: "daily-triage" },
          ],
        },
      },
      {
        id: "sales-agent",
        name: "Sales Agent",
        description: null,
        avatarUrl: null,
        suggestions: undefined,
      },
    ]);
  });

  it("normalizes an empty list", () => {
    assertEquals(normalizeAgentsListResponse({ agents: [] }), []);
  });

  it("rejects a response whose agents is not an array", async () => {
    await assertRejects(
      async () => {
        normalizeAgentsListResponse({ agents: {} });
      },
      Error,
      "agents must be an array",
    );
  });

  it("rejects a response missing the agents field", async () => {
    await assertRejects(
      async () => {
        normalizeAgentsListResponse({});
      },
      Error,
      "agents must be an array",
    );
  });

  it("rejects a list entry missing a required field", async () => {
    await assertRejects(
      async () => {
        normalizeAgentsListResponse({ agents: [{ id: "support-agent" }] });
      },
      Error,
      "name is required",
    );
  });
});

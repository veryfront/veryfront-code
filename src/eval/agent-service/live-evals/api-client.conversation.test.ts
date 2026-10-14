import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createLiveEvalConversation, deleteLiveEvalConversation } from "./api-client.ts";

const CONVERSATION_ID = "64fb6029-c081-4f3b-8612-770371e9fab7";

interface RecordedRequest {
  url: string;
  method?: string;
  body: unknown;
}

function recordingContext(projectId: string | null, response: () => Response) {
  const requests: RecordedRequest[] = [];
  return {
    requests,
    context: {
      apiUrl: "https://api.example.test",
      authToken: "test-token",
      projectId,
      fetch: (input: string | URL | Request, init?: RequestInit) => {
        requests.push({
          url: String(input),
          method: init?.method,
          body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
        });
        return Promise.resolve(response());
      },
    },
  };
}

describe("live eval conversation requests", () => {
  it("names the project as project_reference when it creates a conversation", async () => {
    const { context, requests } = recordingContext(
      "project_123",
      () => Response.json({ id: CONVERSATION_ID }, { status: 201 }),
    );

    const id = await createLiveEvalConversation(context, {
      title: "Eval case",
      requestTimeoutMs: 1_000,
    });

    assertEquals(id, CONVERSATION_ID);
    assertEquals(requests, [{
      url: "https://api.example.test/conversations",
      method: "POST",
      body: { project_reference: "project_123", title: "Eval case" },
    }]);
  });

  it("creates a conversation without a project when the eval has none", async () => {
    const { context, requests } = recordingContext(
      null,
      () => Response.json({ id: CONVERSATION_ID }, { status: 201 }),
    );

    await createLiveEvalConversation(context, { title: "Eval case", requestTimeoutMs: 1_000 });

    assertEquals(requests[0]?.body, { title: "Eval case" });
  });

  it("accepts the empty 204 response when it deletes a conversation", async () => {
    const { context, requests } = recordingContext(
      null,
      () => new Response(null, { status: 204 }),
    );

    await deleteLiveEvalConversation(context, {
      conversationId: CONVERSATION_ID,
      requestTimeoutMs: 1_000,
    });

    assertEquals(requests, [{
      url: `https://api.example.test/conversations/${CONVERSATION_ID}`,
      method: "DELETE",
      body: undefined,
    }]);
  });
});

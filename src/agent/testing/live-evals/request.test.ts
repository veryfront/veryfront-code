import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { buildLiveEvalRequestBody } from "./request.ts";

describe("agent testing live eval request", () => {
  it("includes forwarded props when context values are provided", () => {
    const originalRandomUuid = crypto.randomUUID;
    let index = 0;
    const ids = [
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
      "33333333-3333-4333-8333-333333333333",
    ];
    Object.defineProperty(crypto, "randomUUID", {
      configurable: true,
      value: () => ids[index++] ?? originalRandomUuid.call(crypto),
    });

    try {
      const body = buildLiveEvalRequestBody({
        testCaseId: "case-a",
        prompt: "Hello",
        metadata: { conversationId: "meta-conversation" },
        projectId: "project-1",
        branchId: "branch-1",
        model: "gpt-test",
        conversationId: "conversation-1",
        allowedTools: ["load_skill"],
        forceRuntimeOverrides: true,
        maxSteps: 4,
      });

      assertEquals(body, {
        threadId: "11111111-1111-4111-8111-111111111111",
        runId: "eval-run-22222222-2222-4222-8222-222222222222",
        state: {
          evalCase: "case-a",
          conversationId: "meta-conversation",
        },
        tools: [],
        context: [],
        forwardedProps: {
          veryfront: {
            projectId: "project-1",
            conversationId: "conversation-1",
            branchId: "branch-1",
            model: "gpt-test",
            runtimeOverrides: {
              allowedTools: ["load_skill"],
              maxSteps: 4,
            },
          },
        },
        messages: [
          {
            id: "33333333-3333-4333-8333-333333333333",
            role: "user",
            content: "Hello",
          },
        ],
      });
    } finally {
      Object.defineProperty(crypto, "randomUUID", {
        configurable: true,
        value: originalRandomUuid,
      });
    }
  });

  it("omits forwarded props when no context values are present", () => {
    const originalRandomUuid = crypto.randomUUID;
    let index = 0;
    const ids = [
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
      "33333333-3333-4333-8333-333333333333",
    ];
    Object.defineProperty(crypto, "randomUUID", {
      configurable: true,
      value: () => ids[index++] ?? originalRandomUuid.call(crypto),
    });

    try {
      const body = buildLiveEvalRequestBody({
        testCaseId: "case-b",
        prompt: "Hi",
        metadata: {},
        projectId: null,
      });

      assertEquals(body.forwardedProps, undefined);
      assertEquals(body.threadId, "11111111-1111-4111-8111-111111111111");
      assertEquals(body.messages[0], {
        id: "33333333-3333-4333-8333-333333333333",
        role: "user",
        content: "Hi",
      });
    } finally {
      Object.defineProperty(crypto, "randomUUID", {
        configurable: true,
        value: originalRandomUuid,
      });
    }
  });
});

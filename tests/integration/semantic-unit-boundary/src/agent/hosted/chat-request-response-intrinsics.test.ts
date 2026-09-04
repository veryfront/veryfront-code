// This security boundary test intentionally replaces a shared-realm constructor,
// so it belongs in the semantic integration suite rather than a unit module.
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parseHostedChatRequestFromRequest } from "#veryfront/agent/hosted/chat-request-parser.ts";
import { createHostedInferenceModelResolver } from "#veryfront/agent/hosted/inference-credential.ts";

const conversationId = "10000000-1000-4000-8000-100000000001";
const messageId = "10000000-1000-4000-8000-100000000002";
const userId = "10000000-1000-4000-8000-100000000004";
const projectId = "10000000-1000-4000-8000-100000000005";
const branchId = "10000000-1000-4000-8000-100000000006";

describe("hosted chat Response intrinsic boundary", () => {
  it("does not expose the inference header through a replaced Response constructor", async () => {
    const inferenceToken = "run-scoped-inference-token";
    const request = new Request("https://agent.example.test/api/runs", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Veryfront-Run-Event-Token": "run-event-service-token",
        "X-Veryfront-Inference-Token": inferenceToken,
      },
      body: JSON.stringify({
        messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: "Hello" }] }],
        context: { conversationId, projectId, branchId },
        durableRootRun: { runId: "run_root_1", messageId },
      }),
    });
    const NativeResponse = globalThis.Response;
    const nativeHasInstance = Function.prototype[Symbol.hasInstance];
    const observedValues: unknown[] = [];
    class ObservingResponse extends NativeResponse {
      static override [Symbol.hasInstance](value: unknown): boolean {
        observedValues.push(value);
        return Reflect.apply(nativeHasInstance, NativeResponse, [value]) as boolean;
      }
    }

    const parsed = await (async () => {
      globalThis.Response = ObservingResponse as typeof Response;
      try {
        return await parseHostedChatRequestFromRequest(request, {
          authenticate: () => Promise.resolve({ userId, authToken: "control-plane-token" }),
          verifyProjectAccess: () => Promise.resolve({ success: true as const }),
          verifyRunEventAppendToken: () => Promise.resolve(true),
        });
      } finally {
        globalThis.Response = NativeResponse;
      }
    })();

    if (parsed instanceof NativeResponse) throw new Error("Expected parsed request");
    assertEquals(observedValues.includes(inferenceToken), false);
    assertEquals(typeof createHostedInferenceModelResolver(parsed), "function");
  });
});

// This security boundary test intentionally mutates shared-realm prototypes,
// so it belongs in the semantic integration suite rather than a unit module.
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { AgentRunSessionManager } from "#veryfront/internal-agents/session-manager.ts";
import { AgentRunCancelHandler } from "#veryfront/server/handlers/request/agent-run-cancel.handler.ts";
import {
  createControlPlaneSignature,
  createCtx,
} from "#veryfront/server/handlers/request/internal-agent-run.test-helpers.ts";

const testApply = Reflect.apply;

async function signedCancel(runId: string, body: string) {
  const { jws, publicKeyPem } = await createControlPlaneSignature(body, {
    requestId: runId,
    requestMethod: "DELETE",
    requestPath: `/api/control-plane/runs/${runId}`,
  });
  return {
    request: new Request(`https://example.com/api/control-plane/runs/${runId}`, {
      method: "DELETE",
      headers: { "content-type": "application/json", "x-veryfront-control-plane-jws": jws },
      body,
    }),
    ctx: createCtx(publicKeyPem),
  };
}

describe("agent run cancel intrinsic boundary", () => {
  it("keeps a plain cancel plain when Object.prototype carries confirmStopped", async () => {
    const runId = "run_inherited_confirm";
    const sessionManager = new AgentRunSessionManager();
    sessionManager.startRun({ runId, threadId: crypto.randomUUID() });
    const handler = new AgentRunCancelHandler(sessionManager);
    const { request, ctx } = await signedCancel(runId, JSON.stringify({ runId }));
    let result: Awaited<ReturnType<AgentRunCancelHandler["handle"]>> | undefined;

    try {
      Object.defineProperty(Object.prototype, "confirmStopped", {
        configurable: true,
        value: true,
        writable: true,
      });
      result = await handler.handle(request, ctx);
    } finally {
      delete (Object.prototype as { confirmStopped?: unknown }).confirmStopped;
    }

    assertExists(result?.response);
    assertEquals(result.response.status, 202);
    assertEquals(await result.response.json(), { accepted: true });
    // No stop tombstone: a parked agent run can resume under the same run ID.
    const settle = sessionManager.stopRegistry.register(runId, () => {});
    settle();
  });

  it("parses stop confirmation without consulting String.prototype.trim", async () => {
    const runId = "run_poisoned_trim";
    const body = JSON.stringify({ runId, confirmStopped: true });
    const sessionManager = new AgentRunSessionManager();
    let aborts = 0;
    const settle = sessionManager.stopRegistry.register(runId, () => {
      aborts++;
    });
    settle();
    const handler = new AgentRunCancelHandler(sessionManager);
    const { request, ctx } = await signedCancel(runId, body);
    const nativeTrim = String.prototype.trim;
    const nativeStringValueOf = String.prototype.valueOf;
    let observedBodyTrims = 0;
    let result: Awaited<ReturnType<AgentRunCancelHandler["handle"]>> | undefined;

    try {
      String.prototype.trim = function () {
        const value = testApply(nativeStringValueOf, this, []) as string;
        if (value === body) {
          observedBodyTrims++;
          return "";
        }
        return testApply(nativeTrim, this, []) as string;
      };
      result = await handler.handle(request, ctx);
    } finally {
      String.prototype.trim = nativeTrim;
    }

    assertExists(result?.response);
    assertEquals(result.response.status, 200);
    assertEquals(await result.response.json(), { accepted: true, stopped: true });
    assertEquals(aborts, 0);
    assertEquals(observedBodyTrims, 0);
  });
});

import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { AgentRunSessionManager } from "#veryfront/internal-agents/session-manager.ts";
import { AgentRunCancelHandler } from "./agent-run-cancel.handler.ts";
import { createControlPlaneSignature, createCtx } from "./internal-agent-run.test-helpers.ts";

describe("server/handlers/request/agent-run-cancel.handler", () => {
  it("cancels an active run with a valid control-plane signature", async () => {
    const sessionManager = new AgentRunSessionManager();
    sessionManager.startRun({ runId: "run_1", threadId: crypto.randomUUID() });

    const handler = new AgentRunCancelHandler(sessionManager);
    const body = JSON.stringify({ runId: "run_1" });
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, { requestId: "run_1" });

    const result = await handler.handle(
      new Request("https://example.com/internal/agents/runs/run_1", {
        method: "DELETE",
        headers: {
          "content-type": "application/json",
          "x-veryfront-control-plane-jws": jws,
        },
        body,
      }),
      createCtx(publicKeyPem),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 202);
    assertEquals(await result.response.json(), { accepted: true });
    assertEquals(sessionManager.getRunStatus("run_1"), null);
  });
});

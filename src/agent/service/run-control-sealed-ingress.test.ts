import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { sealIngressCredentials } from "#veryfront/security/http/ingress-credentials.ts";
import { createHostedServiceAuth } from "./auth.ts";
import { createHostedAgentServiceRouteSet } from "./routes.ts";
import { createDetachedRunTracker } from "./detached-run-tracker.ts";
import type { AgUiResumeValue } from "../ag-ui/tool-shared.ts";
import type { TokenPayload } from "#veryfront/extensions/auth/index.ts";
import cancellation from "../../../tests/fixtures/contracts/api-run-cancellation-jwt-payload.json" with {
  type: "json",
};
import resume from "../../../tests/fixtures/contracts/api-run-resume-jwt-payload.json" with {
  type: "json",
};

function fixture(operation: "cancel" | "resume") {
  const claims = {
    ...(operation === "cancel" ? cancellation : resume).projectScoped.payload,
    exp: 4_000_000_000,
  };
  const token = "synthetic-signed-run-control-token";
  const auth = createHostedServiceAuth({
    getConfig: () => ({
      VERYFRONT_API_URL: "https://api.example.test",
      OAUTH_PUBLIC_KEY: "test-public-key",
      SERVICE_ACCOUNT_VERYFRONT_SERVER_ID: claims.serviceAccountId,
    }),
    authProvider: {
      verifyWithPublicKey: async (value) => {
        assertEquals(value, token);
        return claims as unknown as TokenPayload;
      },
    },
  });
  const tracker = createDetachedRunTracker<AgUiResumeValue>();
  const signal = tracker.sessionManager.startRun({
    runId: claims.runId,
    threadId: crypto.randomUUID(),
  });
  const routes = createHostedAgentServiceRouteSet({
    tracker,
    authenticateRequest: (request) => {
      // Authentication must use the private store; headers stay safe for framework callbacks.
      assertEquals(request.headers.get("authorization"), null);
      return auth.authenticateRequest(request);
    },
    verifyProjectAccess: () =>
      Promise.reject(new Error("Run control must not recheck project membership")),
    verifyRunCancellationToken: auth.verifyRunCancellationToken,
    verifyRunResumeToken: auth.verifyRunResumeToken,
    prepareExecution: () => Promise.reject(new Error("Unexpected execution")),
    streamExecutionToAgUiResponse: () => new Response(),
    startDetachedExecution: () => Promise.reject(new Error("Unexpected execution")),
  });
  function request(target: string = claims.runId) {
    return sealIngressCredentials(
      new Request(
        `https://runtime.example.test/api/control-plane/runs/${target}${
          operation === "resume" ? "/resume" : ""
        }`,
        {
          method: operation === "resume" ? "POST" : "DELETE",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify(
            operation === "resume"
              ? { type: "tool_result", toolCallId: "tool_1", result: { ok: true } }
              : { runId: target },
          ),
        },
      ),
    );
  }
  async function handle(target: string = claims.runId) {
    if (operation === "cancel") {
      return routes.handleDurableChatRunCancelRequest({ request: request(target), runId: target });
    }
    const route = routes.routes.find((route) =>
      route.method === "POST" && route.path === "/api/control-plane/runs/:runId/resume"
    );
    if (!route) throw new Error("Missing canonical resume route");
    return await route.handler(request(target), { runId: target });
  }
  return { auth, token, tracker, signal, request, handle, runId: claims.runId };
}

describe("sealed run-control ingress", () => {
  it("reads a sealed control bearer without putting it back in headers", () => {
    const f = fixture("cancel");
    try {
      const request = f.request();
      assertEquals(request.headers.get("authorization"), null);
      assertEquals(f.auth.getTokenFromRequest(request), f.token);
    } finally {
      f.tracker.reset();
    }
  });
  for (const operation of ["cancel", "resume"] as const) {
    it(`authenticates sealed ${operation} through the bounded authentication clone`, async () => {
      const f = fixture(operation);
      const resumed = operation === "resume"
        ? f.tracker.sessionManager.waitForSignal(f.runId, "tool_1").catch(() => undefined)
        : undefined;
      try {
        const response = await f.handle();
        assertEquals(response.status, operation === "cancel" ? 202 : 200);
        if (operation === "cancel") assertEquals(f.signal.aborted, true);
        else assertEquals(await resumed, { result: { ok: true }, isError: false });
      } finally {
        f.tracker.reset();
        await resumed;
      }
    });
    it(`denies sealed ${operation} authority for another run`, async () => {
      const f = fixture(operation);
      try {
        const response = await f.handle("run_foreign");
        assertEquals(response.status, 403);
        assertEquals(f.signal.aborted, false);
      } finally {
        f.tracker.reset();
      }
    });
  }
});

import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createHostedServiceAuth } from "./auth.ts";
import { createHostedAgentServiceRouteSet } from "./routes.ts";
import { createDetachedRunTracker } from "./detached-run-tracker.ts";
import type { AgUiResumeValue } from "../ag-ui/tool-shared.ts";

const runId = "run-owned";
const serverId = "test-server-account";
const projectClaims = {
  sub: serverId,
  userId: serverId,
  serviceAccountId: serverId,
  actorType: "service_account",
  projectId: "project-owned",
  runId,
  scope: ["projects:read"],
  exp: 4_000_000_000,
};
const globalClaims = {
  sub: "test-user",
  userId: "test-user",
  email: "test@example.test",
  runId,
  scope: ["read", "write", "delete"],
  exp: 4_000_000_000,
};

describe("hosted cancellation token authorization", () => {
  for (const claims of [projectClaims, globalClaims]) {
    it(`accepts API-issued exact-run ${claims === projectClaims ? "project" : "global"} authority`, async () => {
      const auth = createHostedServiceAuth({
        getConfig: () => ({
          VERYFRONT_API_URL: "https://api.example.test",
          OAUTH_PUBLIC_KEY: "test-public-key",
          SERVICE_ACCOUNT_VERYFRONT_SERVER_ID: serverId,
        }),
        authProvider: {
          verifyWithPublicKey: (token, key, options) => {
            assertEquals(token, "signed-cancellation-token");
            assertEquals(key, "test-public-key");
            assertEquals(options?.algorithms, ["RS256"]);
            return Promise.resolve(claims);
          },
        },
      });
      assertEquals(
        await auth.verifyRunCancellationToken({ token: "signed-cancellation-token", runId }),
        true,
      );
    });
  }
  for (
    const [name, claims] of Object.entries({
      "ordinary user bearer": { ...globalClaims, runId: undefined },
      "foreign run": { ...projectClaims, runId: "run-foreign" },
      "foreign server": { ...projectClaims, userId: "foreign", serviceAccountId: "foreign" },
      "actor account": { ...projectClaims, serviceAccountId: "actor-account" },
      "missing project": { ...projectClaims, projectId: undefined },
      "event writer": { ...projectClaims, tokenUse: "run_event_writer" },
      "inference token": { ...projectClaims, tokenUse: "runtime_inference" },
      "wrong project scopes": { ...projectClaims, scope: ["runs:read"] },
      "ambiguous scopes": { ...projectClaims, scopes: ["projects:read"] },
      "user with project": { ...globalClaims, projectId: "project-owned" },
      "missing user permission": { ...globalClaims, scope: ["read"] },
      "missing user": { ...globalClaims, userId: undefined },
      "expired": { ...globalClaims, exp: 1 },
      "missing expiry": { ...globalClaims, exp: undefined },
    })
  ) {
    it(`rejects ${name}`, async () => {
      const auth = createHostedServiceAuth({
        getConfig: () => ({
          VERYFRONT_API_URL: "https://api.example.test",
          OAUTH_PUBLIC_KEY: "test-public-key",
          SERVICE_ACCOUNT_VERYFRONT_SERVER_ID: serverId,
        }),
        authProvider: { verifyWithPublicKey: () => Promise.resolve(claims) },
      });
      assertEquals(await auth.verifyRunCancellationToken({ token: "signed-token", runId }), false);
    });
  }
  it("never accepts development decode fallback or a failed signature", async () => {
    for (const publicKey of [undefined, "test-public-key"]) {
      const auth = createHostedServiceAuth({
        getConfig: () => ({
          VERYFRONT_API_URL: "https://api.example.test",
          OAUTH_PUBLIC_KEY: publicKey,
          NODE_ENV: "development",
        }),
        authProvider: { verifyWithPublicKey: () => Promise.reject(new Error("Invalid signature")) },
      });
      assertEquals(
        await auth.verifyRunCancellationToken({ token: "unsigned-token", runId }),
        false,
      );
    }
  });
});

describe("hosted cancellation route authorization", () => {
  for (const allowed of [false, true, undefined]) {
    for (const active of [false, true]) {
      it(`authorizes before cancellation or tombstones (allowed=${allowed}, active=${active})`, async () => {
        const tracker = createDetachedRunTracker<AgUiResumeValue>();
        const signal = active
          ? tracker.sessionManager.startRun({ runId, threadId: "thread" })
          : undefined;
        const routeSet = createHostedAgentServiceRouteSet({
          tracker,
          authenticateRequest: () =>
            Promise.resolve({ userId: "caller", authToken: "signed-token" }),
          verifyProjectAccess: () => Promise.resolve({ success: true }),
          verifyRunCancellationToken: allowed === undefined ? undefined : (input) => {
            assertEquals(input, { runId, token: "signed-token" });
            return Promise.resolve(allowed);
          },
          prepareExecution: () => Promise.reject(new Error("Unexpected preparation")),
          streamExecutionToAgUiResponse: () => new Response(),
          startDetachedExecution: () => Promise.reject(new Error("Unexpected execution")),
        });
        try {
          const response = await routeSet.handleDurableChatRunCancelRequest({
            request: new Request(`https://agent.example.test/api/runs/${runId}`, {
              method: "DELETE",
            }),
            runId,
          });
          assertEquals(response.status, allowed ? active ? 202 : 204 : 403);
          if (signal) assertEquals(signal.aborted, allowed === true);
          else if (allowed) {
            assertThrows(() => tracker.sessionManager.startRun({ runId, threadId: "thread" }));
          } else tracker.sessionManager.startRun({ runId, threadId: "thread" });
        } finally {
          tracker.reset();
        }
      });
    }
  }
});

import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createHostedServiceAuth } from "./auth.ts";
import { createHostedAgentServiceRouteSet } from "./routes.ts";
import { createDetachedRunTracker } from "./detached-run-tracker.ts";
import type { AgUiResumeValue } from "../ag-ui/tool-shared.ts";
import type { TokenPayload } from "#veryfront/extensions/auth/index.ts";

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

function authForClaims(claims: TokenPayload) {
  return createHostedServiceAuth({
    getConfig: () => ({
      VERYFRONT_API_URL: "https://api.example.test",
      OAUTH_PUBLIC_KEY: "test-public-key",
      SERVICE_ACCOUNT_VERYFRONT_SERVER_ID: serverId,
    }),
    authProvider: { verifyWithPublicKey: () => Promise.resolve(claims) },
  });
}

describe("hosted cancellation token authorization", () => {
  it("rejects thenable request inheritance before invoking the JWT provider", async () => {
    let verifications = 0;
    let thenReads = 0;
    const inherited = Object.create(null);
    Object.defineProperty(inherited, "then", {
      get() {
        thenReads++;
        return () => {};
      },
    });
    const input = { token: "signed-token", runId };
    Object.setPrototypeOf(input, inherited);
    const auth = createHostedServiceAuth({
      getConfig: () => ({
        VERYFRONT_API_URL: "https://api.example.test",
        OAUTH_PUBLIC_KEY: "public-key",
      }),
      authProvider: {
        verifyWithPublicKey: () => {
          verifications++;
          return Promise.resolve(globalClaims);
        },
      },
    });
    assertEquals(await auth.verifyRunCancellationToken(input), false);
    assertEquals(verifications, 0);
    assertEquals(thenReads, 0);
  });
  for (const key of ["OAUTH_PUBLIC_KEY", "SERVICE_ACCOUNT_VERYFRONT_SERVER_ID"]) {
    it(`does not accept inherited ${key} configuration`, async () => {
      const config = {
        VERYFRONT_API_URL: "https://api.example.test",
        OAUTH_PUBLIC_KEY: "test-public-key",
        SERVICE_ACCOUNT_VERYFRONT_SERVER_ID: serverId,
      };
      const value = config[key as keyof typeof config];
      Reflect.deleteProperty(config, key);
      Object.setPrototypeOf(config, { [key]: value });
      const auth = createHostedServiceAuth({
        getConfig: () => config,
        authProvider: { verifyWithPublicKey: () => Promise.resolve(projectClaims) },
      });
      assertEquals(await auth.verifyRunCancellationToken({ token: "signed-token", runId }), false);
    });
  }
  for (const key of ["token", "runId"]) {
    it(`requires an own ${key} in the cancellation request`, async () => {
      const input = { token: "signed-token", runId };
      const value = input[key as keyof typeof input];
      Reflect.deleteProperty(input, key);
      Object.setPrototypeOf(input, { [key]: value });
      assertEquals(await authForClaims(globalClaims).verifyRunCancellationToken(input), false);
    });
  }
  it("accepts reordered scopes but rejects duplicates and non-array values", async () => {
    for (
      const [scope, expected] of [
        [["delete", "read", "write"], true],
        [["read", "read", "delete"], false],
        [["read", "write", "delete", "extra"], false],
        [{ 0: "read", 1: "write", 2: "delete", length: 3 }, false],
        [null, false],
      ] as const
    ) {
      assertEquals(
        await authForClaims({ ...globalClaims, scope }).verifyRunCancellationToken({
          token: "signed-token",
          runId,
        }),
        expected,
      );
    }
  });
  for (
    const key of ["runId", "userId", "exp", "scope", "actorType", "serviceAccountId", "projectId"]
  ) {
    it(`rejects an inherited ${key} authorization claim`, async () => {
      // Use a fixture-owned prototype; never modify shared native prototypes locally.
      const claims: TokenPayload = { ...projectClaims };
      const inherited = claims[key];
      delete claims[key];
      Object.setPrototypeOf(claims, { [key]: inherited });
      assertEquals(
        await authForClaims(claims).verifyRunCancellationToken({ token: "signed-token", runId }),
        false,
      );
    });
  }
  it("rejects an ordinary user token with an inherited victim run ID", async () => {
    const claims: TokenPayload = { ...globalClaims };
    delete claims.runId;
    Object.setPrototypeOf(claims, { runId });
    assertEquals(
      await authForClaims(claims).verifyRunCancellationToken({ token: "signed-user-token", runId }),
      false,
    );
  });
  for (
    const key of [
      "runId",
      "userId",
      "exp",
      "scope",
      "actorType",
      "serviceAccountId",
      "projectId",
      "tokenUse",
      "scopes",
    ]
  ) {
    it(`rejects an accessor-backed ${key} claim without invoking it`, async () => {
      const claims: TokenPayload = { ...globalClaims };
      const value = claims[key];
      let reads = 0;
      Object.defineProperty(claims, key, {
        get() {
          reads++;
          return value;
        },
      });
      assertEquals(
        await authForClaims(claims).verifyRunCancellationToken({ token: "signed-token", runId }),
        false,
      );
      assertEquals(reads, 0);
    });
  }
  it("uses only signed own claims when optional claim names are inherited", async () => {
    const claims = { ...globalClaims };
    Object.setPrototypeOf(claims, {
      tokenUse: "run_event_writer",
      scopes: ["runs:write"],
      actorType: "service_account",
      projectId: "foreign-project",
      serviceAccountId: "foreign-account",
    });
    assertEquals(
      await authForClaims(claims).verifyRunCancellationToken({ token: "signed-token", runId }),
      true,
    );
  });
  it("does not delegate scope authorization to supplied array methods", async () => {
    let callbacks = 0;
    const scope = ["unrelated-a", "unrelated-b", "unrelated-c"];
    scope.includes = () => {
      callbacks++;
      return true;
    };
    assertEquals(
      await authForClaims({ ...globalClaims, scope }).verifyRunCancellationToken({
        token: "signed-token",
        runId,
      }),
      false,
    );
    assertEquals(callbacks, 0);
  });
  it("accepts own scope entries without invoking array iteration callbacks", async () => {
    let callbacks = 0;
    const scope = [...globalClaims.scope];
    Object.defineProperty(scope, Symbol.iterator, {
      value() {
        callbacks++;
        throw new Error("Unexpected iteration");
      },
    });
    Object.defineProperty(scope, "every", {
      value() {
        callbacks++;
        return false;
      },
    });
    assertEquals(
      await authForClaims({ ...globalClaims, scope }).verifyRunCancellationToken({
        token: "signed-token",
        runId,
      }),
      true,
    );
    assertEquals(callbacks, 0);
  });
  it("rejects inherited and accessor-backed scope entries", async () => {
    for (const accessor of [false, true]) {
      const scope = [...globalClaims.scope];
      let reads = 0;
      if (accessor) {
        Object.defineProperty(scope, "0", {
          get() {
            reads++;
            return "read";
          },
        });
      } else {
        delete scope[0];
        Object.setPrototypeOf(scope, Object.create(Array.prototype, { "0": { value: "read" } }));
      }
      assertEquals(
        await authForClaims({ ...globalClaims, scope }).verifyRunCancellationToken({
          token: "signed-token",
          runId,
        }),
        false,
      );
      assertEquals(reads, 0);
    }
  });
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
  it("rejects thenable request inheritance before authentication or cancellation", async () => {
    const tracker = createDetachedRunTracker<AgUiResumeValue>();
    const signal = tracker.sessionManager.startRun({ runId, threadId: "thread" });
    let authentications = 0;
    const routes = createHostedAgentServiceRouteSet({
      tracker,
      authenticateRequest: () => {
        authentications++;
        return Promise.resolve({ userId: "caller", authToken: "token" });
      },
      verifyRunCancellationToken: () => Promise.resolve(true),
      verifyProjectAccess: () => Promise.resolve({ success: true }),
      prepareExecution: () => Promise.reject(new Error("Unexpected preparation")),
      streamExecutionToAgUiResponse: () => new Response(),
      startDetachedExecution: () => Promise.reject(new Error("Unexpected execution")),
    });
    const input = {
      request: new Request(`https://agent.example.test/api/runs/${runId}`, { method: "DELETE" }),
      runId,
    };
    Object.setPrototypeOf(input, { then() {} });
    try {
      const response = await routes.handleDurableChatRunCancelRequest(input);
      assertEquals(response.status, 403);
      assertEquals(authentications, 0);
      assertEquals(signal.aborted, false);
    } finally {
      tracker.reset();
    }
  });
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

import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createHostedServiceAuth } from "./auth.ts";
import { createHostedAgentServiceRouteSet } from "./routes.ts";
import { createDetachedRunTracker } from "./detached-run-tracker.ts";
import type { AgUiResumeValue } from "../ag-ui/tool-shared.ts";
import type { TokenPayload } from "#veryfront/extensions/auth/index.ts";
import apiRunCancellationContract from "../../../tests/fixtures/contracts/api-run-cancellation-jwt-payload.json" with {
  type: "json",
};

// Both accepted shapes are taken from the producer contract fixture instead of
// being hand-written here. A hand-written positive fixture is how the verifier
// came to require `tokenUse` to be absent while the API stamps it on every
// project-bound cancellation bearer: the test agreed with the bug.
const CONTRACT_EXPIRY_SECONDS = 4_000_000_000;
const runId = apiRunCancellationContract.projectScoped.payload.runId;
const serverId = apiRunCancellationContract.projectScoped.payload.serviceAccountId;
const projectClaims = {
  ...apiRunCancellationContract.projectScoped.payload,
  exp: CONTRACT_EXPIRY_SECONDS,
};
const globalClaims = {
  ...apiRunCancellationContract.projectless.payload,
  exp: CONTRACT_EXPIRY_SECONDS,
};

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  let hex = "";
  for (const byte of new Uint8Array(digest)) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

// The claim records are the API's real payloads, which carry no `sub`, so they
// are typed as plain records and cast at the AuthProvider boundary. The verifier
// reads own data properties rather than trusting the declared claim type.
type CancellationClaims = Record<string, unknown>;

function asClaims(claims: CancellationClaims): TokenPayload {
  return claims as TokenPayload;
}

function authForClaims(claims: CancellationClaims) {
  return createHostedServiceAuth({
    getConfig: () => ({
      VERYFRONT_API_URL: "https://api.example.test",
      OAUTH_PUBLIC_KEY: "test-public-key",
      SERVICE_ACCOUNT_VERYFRONT_SERVER_ID: serverId,
    }),
    authProvider: { verifyWithPublicKey: () => Promise.resolve(asClaims(claims)) },
  });
}

function cancelRouteSet(
  tracker: ReturnType<typeof createDetachedRunTracker<AgUiResumeValue>>,
  callerUserId: string,
  claims: CancellationClaims,
) {
  return createHostedAgentServiceRouteSet({
    tracker,
    authenticateRequest: () =>
      Promise.resolve({ userId: callerUserId, authToken: "signed-cancellation-token" }),
    verifyProjectAccess: () => Promise.resolve({ success: true }),
    verifyRunCancellationToken: (input) => authForClaims(claims).verifyRunCancellationToken(input),
    prepareExecution: () => Promise.reject(new Error("Unexpected preparation")),
    streamExecutionToAgUiResponse: () => new Response(),
    startDetachedExecution: () => Promise.reject(new Error("Unexpected execution")),
  });
}

function cancelRequest(targetRunId: string) {
  return {
    request: new Request(`https://agent.example.test/api/runs/${targetRunId}`, {
      method: "DELETE",
    }),
    runId: targetRunId,
  };
}

describe("hosted cancellation token authorization", () => {
  it("pins the cross-repo cancellation claim contract", async () => {
    assertEquals(
      apiRunCancellationContract.contractId,
      "veryfront.run-cancellation.jwt-payload.v1",
    );
    assertEquals(
      apiRunCancellationContract.producer,
      "veryfront-api/src/usecases/agent-execution/runtime-auth-token.ts",
    );
    assertEquals(apiRunCancellationContract.serviceIdentity, "veryfront-server");
    for (const shape of ["projectScoped", "projectless"] as const) {
      assertEquals(
        await sha256Hex(JSON.stringify(apiRunCancellationContract[shape].payload)),
        apiRunCancellationContract[shape].payloadSha256,
        `${shape} contract payload changed without its recorded digest`,
      );
    }
  });
  it("accepts the tokenUse the API stamps on every project-bound cancellation bearer", async () => {
    // mintRuntimeCancellationAuthToken routes a run with a projectId through
    // mintProjectScopedServiceToken, whose `tokenUse` defaults to this value.
    // Requiring the claim to be absent denied every project run's Stop.
    assertEquals(
      apiRunCancellationContract.projectScoped.payload.tokenUse,
      "project_scoped_service_account",
    );
    assertEquals(
      await authForClaims(projectClaims).verifyRunCancellationToken({
        token: "signed-token",
        runId,
      }),
      true,
    );
  });
  it("fails loudly if the API's authenticated user scope list drifts", async () => {
    // veryfront-api AUTHENTICATED_USER_SCOPES. The projectless bearer must
    // carry exactly this set; an addition on the API side that does not land
    // here would silently 403 every projectless cancel.
    assertEquals(apiRunCancellationContract.projectless.payload.scope, [
      "read",
      "write",
      "delete",
    ]);
    for (const scope of [["read", "write"], ["read", "write", "delete", "admin"]]) {
      assertEquals(
        await authForClaims({ ...globalClaims, scope }).verifyRunCancellationToken({
          token: "signed-token",
          runId,
        }),
        false,
      );
    }
  });
  for (
    const [shape, claims] of [
      ["projectless", globalClaims],
      ["project", projectClaims],
    ] as const
  ) {
    it(`rejects another user's own valid ${shape} cancellation authority`, async () => {
      const foreignRunId = "run_user_b";
      const foreignClaims = {
        ...claims,
        runId: foreignRunId,
        ...(shape === "projectless"
          ? { userId: "33333333-3333-4333-8333-333333333333", email: "b@example.test" }
          : { projectId: "44444444-4444-4444-8444-444444444444" }),
      };
      const auth = authForClaims(foreignClaims);
      // The credential is genuine authority over user B's own run.
      assertEquals(
        await auth.verifyRunCancellationToken({ token: "signed-token", runId: foreignRunId }),
        true,
      );
      // The same credential is not authority over user A's run.
      assertEquals(
        await auth.verifyRunCancellationToken({ token: "signed-token", runId }),
        false,
      );
    });
  }
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
          return Promise.resolve(asClaims(globalClaims));
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
        authProvider: { verifyWithPublicKey: () => Promise.resolve(asClaims(projectClaims)) },
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
      const claims: CancellationClaims = { ...projectClaims };
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
    const claims: CancellationClaims = { ...globalClaims };
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
      const claims: CancellationClaims = { ...globalClaims };
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
  for (const claims of [projectClaims, globalClaims] as CancellationClaims[]) {
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
            return Promise.resolve(asClaims(claims));
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
    const [name, claims] of Object.entries<CancellationClaims>({
      "ordinary user bearer": { ...globalClaims, runId: undefined },
      "foreign run": { ...projectClaims, runId: "run-foreign" },
      "foreign server": { ...projectClaims, userId: "foreign", serviceAccountId: "foreign" },
      "actor account": { ...projectClaims, serviceAccountId: "actor-account" },
      "missing project": { ...projectClaims, projectId: undefined },
      "event writer": { ...projectClaims, tokenUse: "run_event_writer" },
      "inference token": { ...projectClaims, tokenUse: "runtime_inference" },
      "project scoped inference": { ...projectClaims, tokenUse: "project_scoped_inference" },
      "run scoped inference": { ...projectClaims, tokenUse: "run_scoped_inference" },
      "run scoped service account": { ...projectClaims, tokenUse: "run_scoped_service_account" },
      // The API never mints a project cancellation bearer without a token use,
      // so a claim set missing it is not the production contract either.
      "project token without the API token use": { ...projectClaims, tokenUse: undefined },
      "user token carrying a service token use": {
        ...globalClaims,
        tokenUse: "project_scoped_service_account",
      },
      "user token carrying a writer token use": { ...globalClaims, tokenUse: "run_event_writer" },
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
        authProvider: { verifyWithPublicKey: () => Promise.resolve(asClaims(claims)) },
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
  for (
    const [shape, claims] of [
      ["project", projectClaims],
      ["projectless", globalClaims],
    ] as const
  ) {
    it(`cancels for an authorized collaborator on the ${shape} contract`, async () => {
      // The API applies its own collaborator permission policy and then mints
      // the run's cancellation bearer from the run — the project service
      // account, or the run's requester for a projectless run — not from
      // whoever pressed Stop. The runtime must therefore honour a collaborator's
      // cancel rather than inventing a creator-only rule of its own.
      const tracker = createDetachedRunTracker<AgUiResumeValue>();
      const signal = tracker.sessionManager.startRun({ runId, threadId: "thread" });
      const routes = cancelRouteSet(tracker, "collaborator-user", claims);
      try {
        const response = await routes.handleDurableChatRunCancelRequest(cancelRequest(runId));
        assertEquals(response.status, 202);
        assertEquals(signal.aborted, true);
      } finally {
        tracker.reset();
      }
    });
  }
  it("refuses a second user's own cancellation bearer against another user's run", async () => {
    const tracker = createDetachedRunTracker<AgUiResumeValue>();
    const signal = tracker.sessionManager.startRun({ runId, threadId: "thread" });
    const routes = cancelRouteSet(tracker, "user-b", {
      ...globalClaims,
      userId: "33333333-3333-4333-8333-333333333333",
      email: "b@example.test",
      runId: "run_user_b",
    });
    try {
      const response = await routes.handleDurableChatRunCancelRequest(cancelRequest(runId));
      assertEquals(response.status, 403);
      assertEquals(signal.aborted, false);
      // A refused cancel must not leave a tombstone that stops a later start.
      tracker.sessionManager.startRun({ runId: "run-later", threadId: "later-thread" });
    } finally {
      tracker.reset();
    }
  });
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

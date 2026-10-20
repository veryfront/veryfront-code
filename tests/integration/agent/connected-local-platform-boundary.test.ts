import "#veryfront/schemas/_test-setup.ts";
import { applyRecoveryToolExecutionPolicy } from "#veryfront/runtime/execution-ownership-guard.ts";
import {
  introduceToolCallOccurrence,
  runWithToolCallOccurrenceDispatch,
} from "#veryfront/runtime/tool-call-occurrence.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { generateKeyPairSync, sign } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { getActiveRuntimeRemoteToolSources } from "../../../src/agent/runtime/remote-tool-source-context.ts";
import { createConnectedLocalPlatformTools } from "../../../src/agent/ag-ui/connected-local-platform-tools.ts";
import { createHostedRunEventWriterCapability } from "../../../src/agent/hosted/child-run-event-writer-token.ts";
import { getVerifiedSkillScriptExecutionCredential } from "../../../src/skill/execution-credential.ts";

const scope = {
  projectId: "22222222-2222-4222-8222-222222222222",
  runId: "connected-boundary-run",
  agentId: "coder",
};
const canonicalRunId = "55555555-5555-4555-8555-555555555555";

async function fixture(
  dependencies: boolean,
  operation: (
    tools: ReturnType<typeof createConnectedLocalPlatformTools>,
    owner: typeof scope,
    token: string,
    platformRequests: Array<{ authorization: string | null; eventToken: string | null }>,
    runCredential: string,
  ) => Promise<void>,
) {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const signed = `${encode({ alg: "RS256", kid: "boundary" })}.${
    encode({
      ...scope,
      userId: "server",
      serviceAccountId: "server",
      actorType: "service_account",
      tokenUse: "run_event_writer",
      scopes: ["agent-runs:events:append"],
      exp: Math.floor(Date.now() / 1000) + 60,
      ...(dependencies ? { platformToolDependencies: [] } : {}),
    })
  }`;
  const token = `${signed}.${
    sign("RSA-SHA256", Buffer.from(signed), privateKey).toString("base64url")
  }`;
  const credentialPayload = `${encode({ alg: "RS256", kid: "boundary" })}.${
    encode({ ...scope, tokenUse: "agent_run_execution", exp: Math.floor(Date.now() / 1000) + 60 })
  }`;
  const runCredential = `${credentialPayload}.${
    sign("RSA-SHA256", Buffer.from(credentialPayload), privateKey).toString("base64url")
  }`;
  const platformRequests: Array<{ authorization: string | null; eventToken: string | null }> = [];
  const transport = (async (input, init) => {
    if (new URL(String(input)).pathname === "/.well-known/jwks.json") {
      return Response.json({
        keys: [{ ...publicKey.export({ format: "jwk" }), kid: "boundary" }],
      });
    }
    const headers = new Headers(init?.headers);
    platformRequests.push({
      authorization: headers.get("authorization"),
      eventToken: headers.get("x-veryfront-run-event-token"),
    });
    const body = JSON.parse(String(init?.body)) as { id: string; method: string };
    return Response.json({
      jsonrpc: "2.0",
      id: body.id,
      result: body.method === "tools/list"
        ? {
          tools: [{
            name: "get_run",
            description: "Read the admitted run",
            inputSchema: { type: "object", properties: {} },
          }],
        }
        : { content: [{ type: "text", text: canonicalRunId }] },
    });
  }) as typeof fetch;
  await withMockFetch(transport, () =>
    operation(
      createConnectedLocalPlatformTools("https://api.veryfront.com", transport, {
        projectContext: { projectSlug: "connected-project", branch: "main" },
      }),
      { ...scope },
      token,
      platformRequests,
      runCredential,
    ));
}

it("binds the admitted run credential while local skill scripts resolve sandbox auth", async () => {
  await fixture(false, async (tools, owner, token, _platformRequests, runCredential) => {
    await tools.register(owner, scope, token, runCredential);
    const writer = createHostedRunEventWriterCapability({
      apiUrl: "https://api.veryfront.com",
      ...scope,
      canonicalRunId,
      runEventAppendToken: token,
    });
    await tools.run({
      owner,
      scope,
      writer,
      canonicalRunId,
      signal: new AbortController().signal,
      admit: () => {
        throw new Error("No tools execute");
      },
    }, () => {
      const credential = getVerifiedSkillScriptExecutionCredential();
      assertEquals(credential, {
        apiUrl: "https://api.veryfront.com",
        authToken: runCredential,
        projectId: scope.projectId,
        projectSlug: "connected-project",
        branch: "main",
        runId: scope.runId,
        agentId: scope.agentId,
      });
      const claims = JSON.parse(
        Buffer.from(runCredential.split(".")[1]!, "base64url").toString(),
      );
      assertEquals(
        { projectId: claims.projectId, runId: claims.runId, agentId: claims.agentId },
        scope,
      );
      return Promise.resolve();
    });
    await tools.revoke(owner);
  });
});

it("executes a legacy writer without a platform dependency claim", async () => {
  await fixture(false, async (tools, owner, token, platformRequests) => {
    await tools.register(owner, scope, token, "fixture-auth");
    const writer = createHostedRunEventWriterCapability({
      apiUrl: "https://api.veryfront.com",
      ...scope,
      canonicalRunId,
      runEventAppendToken: token,
    });
    assertEquals(
      await tools.run({
        owner,
        scope,
        writer,
        canonicalRunId,
        signal: new AbortController().signal,
        admit: () => {
          throw new Error("No tools execute");
        },
      }, () => {
        const source = getActiveRuntimeRemoteToolSources()?.[0];
        assertEquals(source?.id, "veryfront-platform-mcp");
        return source!.executeTool("veryfront__get_run", {}, scope);
      }),
      canonicalRunId,
    );
    assertEquals(platformRequests, [
      { authorization: "Bearer fixture-auth", eventToken: token },
      { authorization: "Bearer fixture-auth", eventToken: token },
    ]);
    await tools.revoke(owner);
  });
});

it("does not expose its platform source through replaced WeakMap methods", async () => {
  await fixture(true, async (tools, owner, token) => {
    const original = WeakMap.prototype.set;
    const split = String.prototype.split;
    let exposedCredential = false;
    String.prototype.split = function (...args) {
      if (String(this) === "fixture-auth") exposedCredential = true;
      return Reflect.apply(split, this, args);
    };
    let exposed = false;
    WeakMap.prototype.set = function (key, value) {
      if (
        value && typeof value.listTools === "function" && typeof value.executeTool === "function"
      ) {
        exposed = true;
      }
      return original.call(this, key, value);
    };
    try {
      await tools.register(owner, scope, token, "fixture-auth");
    } finally {
      WeakMap.prototype.set = original;
      String.prototype.split = split;
      await tools.revoke(owner);
    }
    assertEquals(exposed, false);
    assertEquals(exposedCredential, false);
  });
});

it("keeps its execution identity private from replaced async storage methods", async () => {
  await fixture(true, async (tools, owner, token) => {
    await tools.register(owner, scope, token, "fixture-auth");
    const writer = createHostedRunEventWriterCapability({
      apiUrl: "https://api.veryfront.com",
      ...scope,
      canonicalRunId,
      runEventAppendToken: token,
    });
    const original = AsyncLocalStorage.prototype.run;
    const originalGet = AsyncLocalStorage.prototype.getStore;
    let exposedIdentity = false;
    AsyncLocalStorage.prototype.run = function <R, TArgs extends unknown[]>(
      store: unknown,
      callback: (...args: TArgs) => R,
      ...args: TArgs
    ): R {
      if (
        store && typeof store === "object" &&
        (Object.keys(store).length === 0 || "policy" in store ||
          (Array.isArray(store) &&
            store.some((source) => typeof source?.executeTool === "function")))
      ) {
        exposedIdentity = true;
      }
      return Reflect.apply(original, this, [store, callback, ...args]) as R;
    };
    AsyncLocalStorage.prototype.getStore = function () {
      const value = Reflect.apply(originalGet, this, []);
      if (
        Array.isArray(value) && value.some((source) => typeof source?.executeTool === "function")
      ) exposedIdentity = true;
      return value;
    };
    try {
      assertEquals(
        await tools.run({
          owner,
          scope,
          writer,
          canonicalRunId,
          signal: new AbortController().signal,
          admit: () => {
            throw new Error("No tools execute");
          },
        }, () => {
          assertEquals(getActiveRuntimeRemoteToolSources()?.length, 1);
          return Promise.resolve("completed");
        }),
        "completed",
      );
    } finally {
      AsyncLocalStorage.prototype.run = original;
      AsyncLocalStorage.prototype.getStore = originalGet;
      await tools.revoke(owner);
    }
    assertEquals(exposedIdentity, false);
  });
});

it("keeps pending dispatch arguments private from replaced Map methods", async () => {
  await fixture(true, async (tools, owner, token) => {
    await tools.register(owner, scope, token, "fixture-auth");
    const writer = createHostedRunEventWriterCapability({
      apiUrl: "https://api.veryfront.com",
      ...scope,
      canonicalRunId,
      runEventAppendToken: token,
    });
    const original = Map.prototype.set;
    let exposed = false;
    Map.prototype.set = function (key, value) {
      if (value?.name === "boundary-private-dispatch") exposed = true;
      return Reflect.apply(original, this, [key, value]);
    };
    try {
      await assertRejects(
        () =>
          tools.run({
            owner,
            scope,
            writer,
            canonicalRunId,
            signal: new AbortController().signal,
            admit: () => {
              throw new Error("Admission fixture stops execution");
            },
          }, async () => {
            const call = { id: "boundary-call" };
            introduceToolCallOccurrence(call);
            await runWithToolCallOccurrenceDispatch(call, () =>
              applyRecoveryToolExecutionPolicy({
                toolName: "boundary-private-dispatch",
                input: { privateArgument: "fixture-value" },
              }, () => Promise.resolve("unused")));
          }),
        Error,
        "Admission fixture stops execution",
      );
    } finally {
      Map.prototype.set = original;
      await tools.revoke(owner);
    }
    assertEquals(exposed, false);
  });
});

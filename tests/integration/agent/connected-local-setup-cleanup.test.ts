import "#veryfront/schemas/_test-setup.ts";
import { createAgentServiceSandboxTools } from "#veryfront/sandbox";
import { generateKeyPairSync, sign } from "node:crypto";
import { it } from "#veryfront/testing/bdd.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { createConnectedLocalRuntime } from "../../../src/agent/ag-ui/connected-local-runtime.ts";
import { createConnectedLocalPlatformTools } from "../../../src/agent/ag-ui/connected-local-platform-tools.ts";
import {
  type HostedPlatformDependencyOwner,
  runWithHostedPlatformDependencies,
} from "../../../src/agent/hosted/platform-dependency-credential.ts";

it("revokes real connected platform authority when setup fails after registration", async () => {
  const projectId = "22222222-2222-4222-8222-222222222222";
  const canonicalRunId = "55555555-5555-4555-8555-555555555555";
  const conversationId = "33333333-3333-4333-8333-333333333333";
  const workerId = "44444444-4444-4444-8444-444444444444";
  const runId = "connected-setup-run";
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const signed = (claims: unknown) => {
    const unsigned = `${encode({ alg: "RS256", kid: "cleanup" })}.${encode(claims)}`;
    return `${unsigned}.${
      sign("RSA-SHA256", Buffer.from(unsigned), privateKey).toString("base64url")
    }`;
  };
  const eventToken = signed({
    projectId,
    runId,
    agentId: "coder",
    userId: "server",
    serviceAccountId: "server",
    actorType: "service_account",
    tokenUse: "run_event_writer",
    scopes: ["agent-runs:events:append"],
    platformToolDependencies: [],
    exp: Math.floor(Date.now() / 1000) + 60,
  });
  const terminalToken = signed({
    runId,
    canonicalRunId,
    tokenUse: "run_event_writer",
    writerPurpose: "current_run_terminal",
    dispatchNonce: "cleanup",
  });
  const worker = {
    id: workerId,
    project_id: projectId,
    implementation_kind: "veryfront-local",
    worker_key: "fixture",
  };
  let owner: HostedPlatformDependencyOwner | undefined;
  let cancelled = 0;
  let markClosing!: () => void;
  const closing = new Promise<void>((resolve) => markClosing = resolve);
  let releaseClose!: () => void;
  const closeGate = new Promise<void>((resolve) => releaseClose = resolve);
  const transport: typeof fetch = (url) => {
    const path = new URL(String(url)).pathname;
    if (path.includes(".well-known")) {
      return Promise.resolve(
        Response.json({ keys: [{ ...publicKey.export({ format: "jwk" }), kid: "cleanup" }] }),
      );
    }
    if (path.endsWith("/workers")) {
      return Promise.resolve(Response.json({ worker, token: "worker-token" }));
    }
    if (path.endsWith("/heartbeat")) return Promise.resolve(Response.json({ worker }));
    if (path.endsWith("/claim")) {
      return Promise.resolve(Response.json({
        credentials: {
          auth_token: signed({ scope: ["sandboxes:write"] }),
          run_event_token: eventToken,
          run_terminal_token: terminalToken,
        },
        run: {
          run_id: runId,
          conversation_id: conversationId,
          message_id: workerId,
          project_id: projectId,
          agent_id: "coder",
          status: "running",
          request_snapshot: null,
          latest_event_id: 0,
          latest_external_event_sequence: 0,
          lease_owner: workerId,
          lease_expires_at: null,
          worker_session: null,
        },
      }));
    }
    if (path.endsWith("/cancel")) {
      cancelled++;
      return Promise.resolve(Response.json({ id: canonicalRunId }));
    }
    return Promise.resolve(
      Response.json({ id: path === "/conversations" ? conversationId : canonicalRunId }),
    );
  };
  await withMockFetch(transport, async () => {
    const runtime = createConnectedLocalRuntime({
      apiBaseUrl: "https://api.veryfront.com",
      apiToken: "fixture-token",
      projectId,
      projectSlug: "fixture",
      studioUrl: "invalid",
    }, {
      fetch: transport,
      log: () => {},
      createPlatformTools: (apiUrl, fetch) => {
        const tools = createConnectedLocalPlatformTools(apiUrl, fetch, {
          async createSandboxTools(input) {
            const sandbox = await createAgentServiceSandboxTools(input);
            return {
              ...sandbox,
              async closeSandbox() {
                markClosing();
                await closeGate;
                await sandbox.closeSandbox();
              },
            };
          },
        });
        return {
          ...tools,
          async register(value, ...args) {
            owner = value;
            await tools.register(value, ...args);
            assertEquals(
              await runWithHostedPlatformDependencies(value, () => Promise.resolve("active")),
              "active",
            );
          },
        };
      },
    });
    const admission = runtime.admit({
      agentId: "coder",
      threadId: "thread",
      messages: [],
      signal: new AbortController().signal,
    });
    const rejected = assertRejects(() => admission);
    try {
      await closing;
      assertEquals(cancelled, 1);
    } finally {
      releaseClose();
    }
    await rejected;
    assertEquals(owner !== undefined, true);
    assertThrows(() => runWithHostedPlatformDependencies(owner!, () => Promise.resolve("leaked")));
    await runtime.dispose();
  });
});

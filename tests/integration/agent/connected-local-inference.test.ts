import { generateKeyPairSync, sign } from "node:crypto";
import "#veryfront/schemas/_test-setup.ts";
import { createEphemeralAgent } from "../../../src/agent/factory.ts";
import { createConnectedLocalRuntime } from "../../../src/agent/ag-ui/connected-local-runtime.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";

describe("connected local inference authority", () => {
  for (const inferenceToken of [undefined, "scoped-inference"] as const) {
    it(`prepares project source only with claimed inference authority (${inferenceToken ?? "missing"})`, async () => {
      const projectId = "22222222-2222-4222-8222-222222222222";
      const workerId = "11111111-1111-4111-8111-111111111111";
      const conversationId = "33333333-3333-4333-8333-333333333333";
      const canonicalId = "77777777-7777-4777-8777-777777777777";
      const runId = "run_local_prepare";
      const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
      const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
      const unsigned = `${encode({ alg: "RS256", kid: "inference-test" })}.${
        encode({
          projectId,
          runId,
          agentId: "assistant",
          userId: "server",
          serviceAccountId: "server",
          actorType: "service_account",
          tokenUse: "run_event_writer",
          scopes: ["agent-runs:events:append"],
          exp: Math.floor(Date.now() / 1000) + 60,
          platformToolDependencies: [],
        })
      }`;
      const writerToken = `${unsigned}.${
        sign("RSA-SHA256", Buffer.from(unsigned), privateKey).toString("base64url")
      }`;
      const terminalToken = `header.${
        btoa(
          JSON.stringify({
            runId,
            canonicalRunId: canonicalId,
            tokenUse: "run_event_writer",
            writerPurpose: "current_run_terminal",
            dispatchNonce: "generation",
          }),
        )
      }.signature`;
      const worker = {
        id: workerId,
        project_id: projectId,
        implementation_kind: "veryfront-local",
        worker_key: "local:test",
      };
      const requests: Array<{ path: string; authorization: string | null }> = [];
      const transport = ((input: string | Request | URL, init?: RequestInit) => {
        const path = new URL(String(input)).pathname;
        requests.push({ path, authorization: new Headers(init?.headers).get("authorization") });
        if (path === "/.well-known/jwks.json") {
          return Promise.resolve(
            Response.json({
              keys: [{ ...publicKey.export({ format: "jwk" }), kid: "inference-test" }],
            }),
          );
        }
        if (path.endsWith("/workers")) {
          return Promise.resolve(Response.json({ worker, token: "worker-token" }));
        }
        if (path.endsWith("/heartbeat")) return Promise.resolve(Response.json({ worker }));
        if (path === "/conversations") {
          return Promise.resolve(Response.json({ id: conversationId }));
        }
        if (path === "/runs") return Promise.resolve(Response.json({ id: canonicalId }));
        if (path.endsWith("/claim")) {
          return Promise.resolve(Response.json({
            credentials: {
              auth_token: "invocation-token",
              run_event_token: writerToken,
              run_terminal_token: terminalToken,
              ...(inferenceToken ? { inference_token: inferenceToken } : {}),
            },
            run: {
              run_id: runId,
              conversation_id: conversationId,
              message_id: workerId,
              project_id: projectId,
              agent_id: "assistant",
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
        if (path === "/ai/models") return Promise.resolve(Response.json({ models: [] }));
        if (path.endsWith("/finalize")) {
          return Promise.resolve(Response.json({ id: canonicalId, status: "failed" }));
        }
        throw new Error(`Unexpected local runtime request: ${path}`);
      }) as typeof fetch;
      Deno.env.set("VERYFRONT_API_URL", "https://api.example.com");
      await withMockFetch(transport, async () => {
        const runtime = createConnectedLocalRuntime({
          apiBaseUrl: "https://api.example.com",
          apiToken: "account-token",
          projectId,
          projectSlug: "sample",
          studioUrl: "https://studio.example.com",
        }, { fetch: transport, log: () => {} });
        const run = await runtime.admit({
          agentId: "assistant",
          threadId: "thread",
          messages: [],
          signal: new AbortController().signal,
        });
        try {
          const source = createEphemeralAgent({
            id: "assistant",
            model: "veryfront-cloud/test-model",
            system: "Local source instructions.",
          });
          if (!inferenceToken) {
            await assertRejects(
              () => run.prepareAgent(source),
              Error,
              "run-scoped inference authority",
            );
            assertEquals(requests.some((r) => r.path === "/ai/models"), false);
          } else {
            const prepared = await run.prepareAgent(source);
            assertEquals(prepared.id, source.id);
            assertEquals(prepared.config.system, source.config.system);
            assertEquals(
              requests.find((r) => r.path === "/ai/models")?.authorization,
              `Bearer ${inferenceToken}`,
            );
          }
        } finally {
          await run.finish("failed");
        }
        const source = createEphemeralAgent({
          id: "assistant",
          system: "You are a helpful assistant.",
          model: "veryfront-cloud/test-model",
        });
        await assertRejects(() => run.prepareAgent(source));
        await runtime.dispose();
        assertEquals(requests.filter((r) => r.path.endsWith("/finalize")).length, 1);
      });
    });
  }
});

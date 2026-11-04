import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";

import { createEmptyDiscoveryResult } from "#veryfront/discovery";
import { AgentRunSessionManager } from "#veryfront/internal-agents/session-manager.ts";
import { AgentStreamHandler } from "#veryfront/server/handlers/request/agent-stream.handler.ts";
import {
  createAgentStreamRequestBody,
  createSourceCapableAgentStreamContext,
} from "#veryfront/server/handlers/request/agent-stream.handler.test-helpers.ts";
import {
  createAgentWithConfig,
  createControlPlaneSignature,
  encodeDataStreamEvent,
} from "#veryfront/server/handlers/request/internal-agent-run.test-helpers.ts";
import { sealIngressCredentials } from "#veryfront/security/http/ingress-credentials.ts";
import { observeFetchRequestInit, withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import type { RemoteToolSource } from "#veryfront/tool";

const projectId = "10000000-1000-4000-8000-100000000005";
const publicRunId = "run_ordinary_root";
const canonicalRunId = "22222222-2222-4222-8222-222222222222";

function terminalToken(runId = publicRunId): string {
  const encoded = btoa(JSON.stringify({
    tokenUse: "run_event_writer",
    writerPurpose: "current_run_terminal",
    runId,
    canonicalRunId,
    dispatchNonce: "dispatch-1",
  })).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  return `header.${encoded}.signature`;
}

for (const testCase of ["valid", "absent", "unverified", "foreign"] as const) {
  Deno.test(`binds ordinary root current-run tools from terminal authority (${testCase})`, async () => {
    const childCase = Deno.env.get("VF_CURRENT_RUN_BINDING_CASE");
    if (childCase !== undefined && childCase !== testCase) return;
    const body = Deno.env.get("VF_CURRENT_RUN_BINDING_BODY") ?? createAgentStreamRequestBody({
      runId: publicRunId,
      credentials: { authToken: "invocation-token" },
      tools: [{ name: "veryfront__get_run" }],
      forwardedProps: {
        clientId: "veryfront-studio",
        veryfront: { client: { id: "veryfront-studio", type: "web", platform: "browser" } },
      },
    });
    const signed = childCase === undefined
      ? await createControlPlaneSignature(body, {
        requestId: publicRunId,
        projectId,
        audience: "test-project",
      })
      : {
        jws: Deno.env.get("VF_CURRENT_RUN_BINDING_JWS")!,
        publicKeyPem: Deno.env.get("CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY")!,
      };
    if (childCase === undefined) {
      const output = await new Deno.Command(Deno.execPath(), {
        args: [
          "test",
          "--no-check",
          "--allow-all",
          "--config",
          "deno.json",
          new URL(import.meta.url).pathname,
        ],
        env: {
          DENO_TESTING: "0",
          NODE_ENV: "production",
          VERYFRONT_API_URL: "https://8.8.8.8",
          VERYFRONT_API_BASE_URL: "https://8.8.8.8",
          VERYFRONT_STUDIO_MCP_URL: "https://8.8.8.8/studio-mcp",
          CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY: signed.publicKeyPem,
          VF_CURRENT_RUN_BINDING_CASE: testCase,
          VF_CURRENT_RUN_BINDING_BODY: body,
          VF_CURRENT_RUN_BINDING_JWS: signed.jws,
        },
        stdout: "piped",
        stderr: "piped",
      }).output();
      assertEquals(
        output.code,
        0,
        new TextDecoder().decode(output.stdout) + new TextDecoder().decode(output.stderr),
      );
      return;
    }

    let sources: RemoteToolSource[] = [];
    const calls: Array<Record<string, unknown>> = [];
    let omittedRejected = 0;
    const token = testCase === "absent"
      ? undefined
      : terminalToken(testCase === "foreign" ? "run_other" : publicRunId);
    const handler = new AgentStreamHandler({
      ensureProjectDiscovery: () => Promise.resolve(createEmptyDiscoveryResult()),
      getAgent: () =>
        createAgentWithConfig("assistant-1", {
          mcpServers: [
            { kind: "veryfront-api", toolPolicy: { allow: ["get_run"] } },
            { kind: "veryfront-studio", toolPolicy: { allow: ["get_run"] } },
          ],
        }),
      getAllAgentIds: () => ["assistant-1"],
      sessionManager: new AgentRunSessionManager(),
      verifyRunTerminalToken: (input) => {
        if (!token) throw new Error("Absent terminal authority must not be verified");
        assertEquals(input, { token, projectId, runId: publicRunId });
        return Promise.resolve(testCase !== "unverified");
      },
      createRuntime: (runtimeAgent) => ({
        stream: () => {
          sources = Reflect.get(runtimeAgent.config, "__vfRemoteToolSources") ?? [];
          return Promise.resolve(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(encodeDataStreamEvent({ type: "text-start", id: "answer" }));
                controller.enqueue(
                  encodeDataStreamEvent({ type: "text-delta", id: "answer", delta: "Done" }),
                );
                controller.close();
              },
            }),
          );
        },
      }),
    });

    await withMockFetch((_url, init) => {
      const request = JSON.parse(String(observeFetchRequestInit(init).body));
      if (request.method === "tools/call") calls.push(request.params);
      return Promise.resolve(Response.json({
        jsonrpc: "2.0",
        id: request.id,
        result: request.method === "tools/list"
          ? {
            tools: [{
              name: "get_run",
              description: "Get a run",
              inputSchema: {
                type: "object",
                properties: { run_id: { type: "string", format: "uuid" } },
                required: ["run_id"],
              },
            }],
          }
          : { content: [{ type: "text", text: "accepted" }] },
      }));
    }, async () => {
      const result = await handler.handle(
        sealIngressCredentials(
          new Request(
            `https://example.com/api/control-plane/runs/${publicRunId}/stream`,
            {
              method: "POST",
              headers: {
                "x-veryfront-control-plane-jws": signed.jws,
                ...(token ? { "x-veryfront-run-terminal-token": token } : {}),
              },
              body,
            },
          ),
        ),
        {
          ...createSourceCapableAgentStreamContext(signed.publicKeyPem),
          projectId,
          projectSlug: "test-project",
          proxyToken: "invocation-token",
        },
      );
      assertExists(result.response);
      assertEquals(result.response.status, 200, await result.response.clone().text());
      await result.response.text();

      const getRunSources: RemoteToolSource[] = [];
      for (const source of sources) {
        if ((await source.listTools()).some(({ name }) => name === "veryfront__get_run")) {
          getRunSources.push(source);
        }
      }
      assertEquals(getRunSources.length, 2);
      for (const source of getRunSources) {
        const [tool] = await source.listTools();
        assertExists(tool);
        assertEquals(
          Reflect.get(tool.parameters, "required"),
          testCase === "valid" ? [] : ["run_id"],
        );
        try {
          await source.executeTool("veryfront__get_run", {}, { runId: publicRunId });
        } catch (error) {
          assertEquals(testCase === "valid", false);
          assertEquals(
            error instanceof Error && error.message.includes("requires input: run_id"),
            true,
          );
          omittedRejected++;
        }
        await source.executeTool(
          "veryfront__get_run",
          { run_id: "33333333-3333-4333-8333-333333333333" },
          { runId: publicRunId },
        );
      }
    });

    assertEquals(calls.length, 4 - omittedRejected);
    const dispatchedRunIds = calls.map((call) =>
      (call.arguments as Record<string, unknown>).run_id
    );
    if (testCase === "valid") {
      assertEquals(dispatchedRunIds, [
        canonicalRunId,
        "33333333-3333-4333-8333-333333333333",
        canonicalRunId,
        "33333333-3333-4333-8333-333333333333",
      ]);
    } else {
      assertEquals(
        omittedRejected + dispatchedRunIds.filter((runId) => runId === undefined).length,
        2,
      );
      assertEquals(
        dispatchedRunIds.filter((runId) => runId !== undefined),
        [
          "33333333-3333-4333-8333-333333333333",
          "33333333-3333-4333-8333-333333333333",
        ],
      );
    }
  });
}

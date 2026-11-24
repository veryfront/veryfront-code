import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { runCanonicalWriterProgram } from "#veryfront/agent/service/canonical-writer.test-helpers.ts";

// Synthetic API/provider/allocator transports, real service composition and
// executor protocol. Hosted image/cluster qualification remains separate.
const program = `
import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { createInstalledCanonicalAgentService } from "veryfront/server/http-broker";
import { initializeExecutorRuntimeContracts } from "veryfront/agent/executor-runtime";
import { createHostedServiceAuth } from "./src/agent/service/auth.ts";
import { invocation, signedRequest, projectId, userId } from "./src/agent/service/broker-ingress.test-helpers.ts";
import { createExecutorChannel } from "./src/agent/executor/channel.ts";
import { createExecutorRuntimeInstallation } from "./src/agent/hosted/executor-runtime-install.ts";
import { createExecutorDiscovery } from "./src/agent/hosted/executor-discovery.ts";
import { createExecutorProjectToolRuntime } from "./src/agent/hosted/executor-project-runtime.ts";
import { agent } from "./src/agent/factory.ts";
import { tool } from "./src/tool/factory.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { __runWithOutboundFetchTransportForTests } from "./src/security/http/outbound-fetch.ts";
await initializeExecutorRuntimeContracts();
const data = JSON.parse(await new Response(Deno.stdin.readable).text());
const sourceId = "00000000-0000-4000-8000-000000000099", environmentId = "00000000-0000-4000-8000-000000000098";
const canonicalId = "30000000-3000-4000-8000-300000000001";
const image = "ghcr.io/veryfront/source@sha256:" + "a".repeat(64);
const source = { type: "release", releaseId: "release-1" };
const owner = { scopeKind: "project", projectId: sourceId };
const apiUrl = data.destinations ? "https://93.184.216.35/api" : "https://93.184.216.34/api";
const inferenceApiBaseUrl = data.destinations ? "https://93.184.216.36/api" : apiUrl;
const terminal = "header." + btoa(JSON.stringify({ runId: "run-1", canonicalRunId: canonicalId, tokenUse: "run_event_writer", writerPurpose: "current_run_terminal", dispatchNonce: "33333333-3333-4333-8333-333333333333" })) + ".signature";
const base = invocation();
const body = invocation({
 run: { ...base.run, project: { ...base.run.project, runtimeTargetBranchName: "main" }, eventCursor: { canonicalRunId: canonicalId, latestEventId: 0, latestExternalEventSequence: 0 } },
 sourceProject: { projectId: sourceId, projectSlug: "private-source", runtimeTargetKind: "environment", runtimeTargetEnvironmentId: environmentId, runtimeTargetEnvironmentName: "production" },
 agentEntrypoint: { path: "agents/selected.ts" },
 messages: [{ id: "user-input", role: "user", content: "Inspect the claim" }],
 tools: [{ name: "inspect", description: "Inspect", parameters: { type: "object", properties: { query: { type: "string" } } } }],
 forwardedProps: { runtimeOverrides: { serverResolvedProjectTools: ["inspect"] } },
 projectEventPersistence: { mode: "runtime-owned-v1", canonicalRunId: canonicalId, latestEventId: 0, latestExternalEventSequence: 0 }, platformToolDependencies: [],
});
if (data.environmentContext) body.context = [{ type: "json", title: "studio_context", data: { environmentContext: "Run-specific ledger context" } }];
if (data.omitEntrypoint) delete body.agentEntrypoint;
if (data.emptyTools) body.forwardedProps.runtimeOverrides.allowedTools = [];
const contract = await import("./src/agent/runtime/agent-invocation-contract.ts");
const parsedBody = contract.safeParseRuntimeAgentRunInvocationValue(body);
if (!parsedBody.success) throw new Error("Synthetic request schema: " + JSON.stringify(parsedBody.error.issues?.map(issue => ({ path: issue.path, message: issue.message }))));
const internal = await import("./src/internal-agents/schema.ts");
const parsedInternal = internal.getInternalAgentControlPlaneStreamRequestSchema().safeParse(contract.buildRuntimeAgentControlPlaneStreamRequestFromInvocation(parsedBody.data));
if (!parsedInternal.success) throw new Error("Synthetic internal schema: " + JSON.stringify(parsedInternal.error.issues?.map(issue => ({ path: issue.path, message: issue.message }))));
const signed = await signedRequest(body, { projectId: sourceId, audience: "private-source" });
signed.request.headers.set("x-veryfront-run-event-token", data.token);
signed.request.headers.set("x-veryfront-run-terminal-token", terminal);
const realAuth = createHostedServiceAuth({ getConfig: () => ({ OAUTH_PUBLIC_KEY: data.publicKeyPem, SERVICE_ACCOUNT_VERYFRONT_SERVER_ID: data.serverId, NODE_ENV: "production", VERYFRONT_API_URL: apiUrl }) });
const auth = { ...realAuth, verifyJwt: async () => ({ success: true, userId, email: "synthetic@example.test", token: "broker-token" }), verifyRunTerminalToken: async value => value.token === terminal && value.projectId === projectId && value.runId === "run-1" };
let knowledgeReads = 0;
let allocations = 0, executions = 0, modelCalls = 0, cursor = 0, wire = "";
const events = [];
let currentRequest, peer, peerCleanup = Promise.resolve();
const view = (phase = "ready", reason) => ({ binding: { allocationId: currentRequest.allocationId, invocationId: currentRequest.invocationId, owner: currentRequest.owner, source: currentRequest.source, executionProfile: currentRequest.executionProfile, generation: 1, brokerInstanceId: "broker-test" }, phase, expiresAt: Math.min(Date.now() + 60000, currentRequest.hardDeadlineAt), ...(reason ? { reason } : {}), ...(phase === "ready" ? { endpoint: { address: "192.0.2.10", port: 8081, podUid: "pod-test", nodeName: "node-test", image, channelAuthenticated: false } } : {}) });
const allocator = { allocate: async request => { allocations++; currentRequest = request; return view(); }, observe: async () => view(), renew: async () => view(), release: async (_binding, reason) => view("released", reason) };
const connectTransport = async ({ binding }) => {
 const outbound = new TransformStream({ transform(chunk, controller) { wire += new TextDecoder().decode(chunk); controller.enqueue(chunk); } });
 const inbound = new TransformStream();
 const installation = createExecutorRuntimeInstallation({ mode: "project-tools", binding, artifact: { version: 1, owner, source, root: "project" }, async install(input, signal, context) {
  const inspect = tool({ id: "inspect", description: "Inspect a claim", inputSchema: defineSchema(v => v.object({ query: v.string() }))(), execute: (args, call) => { executions++; assertEquals(args, { query: "approved" }); assertEquals(call.projectId, projectId); assertEquals(call.userId, userId); assertEquals(call.runId, "run-1"); return { ok: true }; } });
  const discovery = createExecutorDiscovery({ binding, source, projectDir: "/synthetic-project", defaultAgentId: input.context.agentId, agentEntrypoint: input.agentEntrypoint, signal, backend: { load: async () => ({ agents: new Map([["builder", agent({ id: "builder", model: "veryfront-cloud/openai/synthetic", system: "Use inspect then answer", tools: data.disableTools ? false : { inspect: true }, skills: false, ...(data.knowledge ? { knowledge: true } : {}), ...(data.explicitMcp ? { mcpServers: [{ kind: "veryfront-api", id: "unneeded" }] } : data.disableTools ? {} : { mcpServers: [] }) })]]), tools: new Map([["inspect", inspect]]), skills: new Map(), prompts: new Map(), resources: new Map(), workflows: new Map(), tasks: new Map(), schedules: new Map(), webhooks: new Map(), evals: new Map(), errors: [], sourceIntegrationPolicy: { schemaVersion: 1, mode: "unrestricted" } }), cleanup: async () => {} } });
  return await createExecutorProjectToolRuntime({ input, discovery, signal, deadline: context.deadline });
 } });
 peer = createExecutorChannel({ binding, operations: installation.operations, transport: { readable: outbound.readable, writable: inbound.writable } });
 return { readable: inbound.readable, writable: outbound.writable, close() { peer.close(); peerCleanup = installation.close(); return peerCleanup; } };
};
const rest = async (value, init) => {
 const request = new Request(value, init), url = new URL(request.url);
 assert(url.origin === new URL(apiUrl).origin, "Source/run request must use the configured API destination");
 if (url.pathname.includes("/projects/")) {
  assertStringIncludes(url.pathname, "/projects/" + sourceId + "/releases/release-1/files");
  assertEquals(request.headers.get("authorization"), "Bearer source-read-token");
  if (data.knowledge && !url.pathname.endsWith("/AGENTS.md")) {
   return Response.json({ release_id: "release-1", release_version: "v1", data: [{ id: "knowledge-file", version_id: "knowledge-version", release_id: "release-1", release_version: "v1", path: "knowledge/claim.md", content: "Claim approval requires signed evidence.", type: "file", size: 45, updated_at: "2026-01-01T00:00:00.000Z" }], page_info: { self: null, first: null, next: null, prev: null } });
  }
  return url.pathname.endsWith("/AGENTS.md") ? Response.json({ path: "AGENTS.md", content: "Captured source context" }) : Response.json({ data: [], page_info: { next: null } });
 }
 assertStringIncludes(url.pathname, "/runs/" + canonicalId);
 if (url.pathname.endsWith("/runtime/admission")) return Response.json({ version: 1, accepted: true, identity: { project_id: projectId, canonical_run_id: canonicalId, public_run_id: "run-1" }, generation: { worker_id: "worker", dispatch_nonce: "33333333-3333-4333-8333-333333333333", transport_recovery_attempt: 0 }, lease_remaining_ms: 5000, acknowledged_event_id: 0, acknowledged_external_sequence: 0 });
 if (request.method === "GET") return Response.json({ id: canonicalId, status: "running" });
 if (url.pathname.endsWith("/events")) { const body = await request.json(); events.push(...body.events); cursor += body.events.length; return Response.json({ run_id: canonicalId, latest_event_id: cursor, latest_external_event_sequence: 0, appended_count: body.events.length }); }
 throw new Error("Unexpected canonical API operation: " + url.pathname);
};
const transport = async (value, init) => {
 const request = new Request(value, init), url = new URL(request.url);
 if (data.knowledge && url.pathname.includes("/projects/")) { knowledgeReads++; return rest(request); }
 assert(url.origin === new URL(inferenceApiBaseUrl).origin, "Inference must use its configured destination");
 assertEquals(request.headers.get("authorization"), "Bearer inference-token");
 assertEquals(request.headers.get("x-veryfront-project-slug"), "demo-project");
 if (url.pathname.endsWith("/ai/models")) return Response.json({ models: [{ id: "synthetic", modelId: "openai/synthetic", provider: "openai", aliases: [], surface: "openai", operations: ["chat-completions"], transport: "chat-completions", supportedProviderTools: [], capabilities: { limit: { output: 4096 } } }] });
 assert(url.pathname.endsWith("/chat/completions"));
 const inference = await request.json();
 if (data.environmentContext) assertStringIncludes(JSON.stringify(inference.messages), "Run-specific ledger context");
 if (data.emptyTools || data.disableTools) assertEquals(inference.tools === undefined || inference.tools.length === 0, true);
 modelCalls++;
 if (data.knowledge && modelCalls === 2) assertStringIncludes(JSON.stringify(inference.messages), "Claim approval requires signed evidence.");
 const delta = data.emptyTools || data.disableTools ? { role: "assistant", content: "Tool-free reply" } : modelCalls === 1 ? { role: "assistant", tool_calls: [{ index: 0, id: "inspect-call", type: "function", function: { name: data.knowledge ? "veryfront__search_knowledge" : "inspect", arguments: JSON.stringify(data.knowledge ? { query: "Claim", lookup_target: "knowledge/claim.md" } : { query: "approved" }) } }] } : { role: "assistant", content: "Claim inspected" };
 const chunks = [{ id: "response-" + modelCalls, object: "chat.completion.chunk", model: "synthetic", choices: [{ index: 0, delta, finish_reason: null }] }, { id: "response-" + modelCalls, object: "chat.completion.chunk", model: "synthetic", choices: [{ index: 0, delta: {}, finish_reason: (data.emptyTools || data.disableTools) ? "stop" : modelCalls === 1 ? "tool_calls" : "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }];
 return new Response(chunks.map(chunk => "data: " + JSON.stringify(chunk) + "\\n\\n").join("") + "data: [DONE]\\n\\n", { headers: { "content-type": "text/event-stream" } });
};
await __runWithOutboundFetchTransportForTests({ fetch: transport, pinnedFetch: (url, _addresses, init) => transport(url, init), resolveHost: async () => ["93.184.216.34"] }, async () => {
 const service = createInstalledCanonicalAgentService({ source: { installations: [{ image, configuration: { projectId: sourceId, projectSlug: "private-source", environmentId, environmentName: "production", releaseId: "release-1", configurationId: "config-1", variables: { PRIVATE: "never-forward" } } }], expectedBrokerInstanceId: "broker-test", allocator, connectTransport }, ingress: { publicKeyPem: signed.publicKeyPem, audience: "private-source", projectId: sourceId, expectedSurface: "studio" }, auth, apiUrl, inferenceApiBaseUrl, apiMcpUrl: apiUrl + "/mcp", modelLimits: { maxCalls: 10, maxConcurrentCalls: 1, maxOutputTokens: 4096, maxSteps: 10 }, toolLimits: { maxCalls: 20, maxConcurrent: 2 }, maxActive: 1, fetch: rest, resolveProvider: () => "openai", createRemoteToolSource: () => { throw new Error("Tool-free execution must not construct MCP sources"); }, onExecutionError: error => console.error("COMPOSITION_ERROR", error) });
 try {
  const response = await service.handle(signed.request);
  const text = await response.text();
  assertEquals(response.status, 200, text);
  assertStringIncludes(text, data.emptyTools || data.disableTools ? "Tool-free reply" : "Claim inspected");
  assertEquals(allocations, 1);
  assertEquals(executions, data.emptyTools || data.disableTools || data.knowledge ? 0 : 1);
  assertEquals(knowledgeReads, data.knowledge && !data.emptyTools && !data.disableTools ? 1 : 0);
  assertEquals(modelCalls, data.emptyTools || data.disableTools ? 1 : 2);
  assert(events.length > 0);
  for (const secret of ["api-auth-token", "source-read-token", "inference-token", "never-forward", data.token]) assertEquals(wire.includes(secret), false);
 } finally { await service.close(); await service.settled; await peerCleanup; }
}, { allowedResolvedAddresses: ["93.184.216.34", "93.184.216.35", "93.184.216.36"] });
console.log("installed-canonical-execution-qualified");
`;

for (
  const scenario of [
    {
      name:
        "installed canonical service executes the selected code agent and native tool with one source allocation",
      input: {},
    },
    {
      name: "installed canonical inference uses its configured destination instead of the boot environment",
      input: { destinations: true },
    },
    {
      name: "installed canonical source knowledge uses its configured API instead of the boot environment",
      input: { destinations: true, knowledge: true },
    },
    {
      name: "installed canonical execution preserves signed Studio context across tool steps",
      input: { environmentContext: true },
    },
    {
      name: "installed canonical agents retrieve immutable source knowledge without exposing credentials",
      input: { knowledge: true },
    },
    {
      name: "empty invocation tools prevent source knowledge retrieval",
      input: { knowledge: true, emptyTools: true },
    },
    {
      name: "installed canonical execution omits an absent entrypoint from bounded protocol data",
      input: { omitEntrypoint: true },
    },
    {
      name: "installed canonical execution preserves an explicit empty invocation tool allowlist",
      input: { emptyTools: true },
    },
    {
      name: "installed canonical tool-free agents start without constructing remote sources",
      input: { disableTools: true },
    },
    {
      name: "closed source tools do not require an unused explicitly configured MCP facade",
      input: { disableTools: true, explicitMcp: true },
    },
    {
      name: "empty invocation tools do not connect or require an unused configured MCP facade",
      input: { emptyTools: true, explicitMcp: true },
    },
  ]
) {
  Deno.test(scenario.name, async () => {
    const output = await runCanonicalWriterProgram(program, scenario.input);
    assertEquals(output.split("\n").at(-1), "installed-canonical-execution-qualified");
  });
}

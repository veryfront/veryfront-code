import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { runCanonicalWriterProgram } from "#veryfront/agent/service/canonical-writer.test-helpers.ts";

const program = `
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { createHostedServiceAuth, getActivePlatformToolDependencies } from "./src/agent/service/auth.ts";
import { invocation, signedRequest, options, projectId, userId } from "./src/agent/service/broker-ingress.test-helpers.ts";
import { parseBrokerRuntimeAgentIngress } from "./src/agent/service/broker-ingress.ts";
import { createCanonicalApiToolSource } from "./src/agent/service/canonical-api-tool-source.ts";
import { prepareCanonicalBrokerTools } from "./src/agent/service/canonical-tool-policy.ts";
const data = JSON.parse(await new Response(Deno.stdin.readable).text());
const auth = createHostedServiceAuth({ getConfig: () => ({ OAUTH_PUBLIC_KEY: data.publicKeyPem, SERVICE_ACCOUNT_VERYFRONT_SERVER_ID: data.serverId, NODE_ENV: "production", VERYFRONT_API_URL: "https://api.example.test" }) });
const verification = await auth.verifyRunEventAppendToken({ token: data.token, projectId, runId: "run-1", agentId: "builder" });
assertEquals(verification.verified, true);
const signed = await signedRequest(invocation({ agentConfig: { id: "builder", name: "Builder", description: "Test", instructions: "Review", mcpServers: [{ kind: "veryfront-api", id: "integration" }] }, tools: [{ name: "api_task", parameters: { type: "object" } }, { name: "native_lookup", parameters: { type: "object" } }], forwardedProps: { runtimeOverrides: { serverResolvedProjectTools: ["native_lookup"] } } }));
const ingress = await parseBrokerRuntimeAgentIngress(signed.request, { ...options(signed.publicKeyPem), authorizeScope: () => ({ principal: { userId }, runEventWriter: verification }) });
const signal = new AbortController().signal;
const apiTools = createCanonicalApiToolSource({ ingress, signal, waitForToolResult: async () => ({ result: "api", isError: false }) });
let calls = 0, disposed = 0;
const createRemoteToolSource = (config) => ({ id: config.id, listTools: async () => [{ name: "remote_lookup", description: "Lookup", parameters: { type: "object", properties: {} } }], executeTool: async (_name, _args, context) => { if (_name === "get_tool_access_profile") return { version: 1, freshness: { resolved_at: "2999-01-01T00:00:00.000Z", valid_for_ms: 60000, fail_closed_on_expiry: true }, families: [] }; calls++; assertEquals(context.projectId, projectId); assertEquals(context.userId, userId); assertEquals(context.authToken, "api-auth-token"); assertEquals(getActivePlatformToolDependencies(context), []); return "remote"; }, dispose: async () => { disposed++; } });
const policy = await prepareCanonicalBrokerTools({ ingress: { ...ingress, executor: { ...ingress.executor, agentConfig: undefined } }, sourceDefinition: ingress.executor.agentConfig, apiTools, signal, apiMcpUrl: "https://api.example.test/mcp", limits: { maxCalls: 10, maxConcurrent: 2 }, createRemoteToolSource });
assertEquals([...policy.tools.catalog.keys()].sort(), ["api_task", "native_lookup", "veryfront__remote_lookup"]);
assertEquals(policy.projectToolNames, ["native_lookup"]);
const capability = policy.tools.sources.get("integration");
assertEquals(await capability.source.executeTool("veryfront__remote_lookup", {}, { ...capability.context, toolCallId: "remote-1" }), "remote");
await assertRejects(() => capability.source.executeTool("veryfront__remote_lookup", {}, { ...capability.context, projectId: "foreign" }));
assertEquals(calls, 1);
await policy.cleanup(); await policy.cleanup();
assertEquals(disposed, 1);
await assertRejects(() => capability.source.executeTool("veryfront__remote_lookup", {}, capability.context));
await assertRejects(() => prepareCanonicalBrokerTools({ sourceDefinition: ingress.executor.agentConfig, ingress: { ...ingress, privateAuthority: { ...ingress.privateAuthority, authorization: { ...ingress.privateAuthority.authorization, runEventWriter: { ...verification } } } }, apiTools, signal, apiMcpUrl: "https://api.example.test/mcp", limits: { maxCalls: 10, maxConcurrent: 2 }, createRemoteToolSource }));
assertEquals(disposed, 1);
console.log("canonical-tool-policy-qualified");
`;

Deno.test("canonical tool preparation preserves verified authority, ownership and retirement", async () => {
  const output = await runCanonicalWriterProgram(program);
  assertEquals(output.split("\n").at(-1), "canonical-tool-policy-qualified");
});

import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import writerContract from "../../../tests/fixtures/contracts/api-run-event-writer-jwt-payload.json" with {
  type: "json",
};

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
const createRemoteToolSource = () => ({ id: "integration", listTools: async () => [{ name: "remote_lookup", description: "Lookup", parameters: { type: "object", properties: {} } }], executeTool: async (_name, _args, context) => { if (_name === "get_tool_access_profile") return { version: 1, freshness: { resolved_at: "2999-01-01T00:00:00.000Z", valid_for_ms: 60000, fail_closed_on_expiry: true }, families: [] }; calls++; assertEquals(context.projectId, projectId); assertEquals(context.userId, userId); assertEquals(context.authToken, "api-auth-token"); assertEquals(getActivePlatformToolDependencies(context), []); return "remote"; }, dispose: async () => { disposed++; } });
const policy = await prepareCanonicalBrokerTools({ ingress, apiTools, signal, apiMcpUrl: "https://api.example.test/mcp", limits: { maxCalls: 10, maxConcurrent: 2 }, createRemoteToolSource });
assertEquals([...policy.tools.catalog.keys()].sort(), ["api_task", "native_lookup", "veryfront__remote_lookup"]);
assertEquals(policy.projectToolNames, ["native_lookup"]);
const capability = policy.tools.sources.get("integration");
assertEquals(await capability.source.executeTool("veryfront__remote_lookup", {}, { ...capability.context, toolCallId: "remote-1" }), "remote");
await assertRejects(() => capability.source.executeTool("veryfront__remote_lookup", {}, { ...capability.context, projectId: "foreign" }));
assertEquals(calls, 1);
await policy.cleanup(); await policy.cleanup();
assertEquals(disposed, 1);
await assertRejects(() => capability.source.executeTool("veryfront__remote_lookup", {}, capability.context));
await assertRejects(() => prepareCanonicalBrokerTools({ ingress: { ...ingress, privateAuthority: { ...ingress.privateAuthority, authorization: { ...ingress.privateAuthority.authorization, runEventWriter: { ...verification } } } }, apiTools, signal, apiMcpUrl: "https://api.example.test/mcp", limits: { maxCalls: 10, maxConcurrent: 2 }, createRemoteToolSource }));
assertEquals(disposed, 1);
console.log("canonical-tool-policy-qualified");
`;

Deno.test("canonical tool preparation preserves verified authority, ownership and retirement", async () => {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const encode = (value: Uint8Array) =>
    btoa(String.fromCharCode(...value)).replaceAll("+", "-").replaceAll("/", "_").replaceAll(
      "=",
      "",
    );
  const json = (value: unknown) => encode(new TextEncoder().encode(JSON.stringify(value)));
  const claims = {
    ...writerContract.payload,
    projectId: "00000000-0000-4000-8000-000000000005",
    runId: "run-1",
    agentId: "builder",
    platformToolDependencies: [],
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
  const signingInput = json({ alg: "RS256", typ: "JWT" }) + "." + json(claims);
  const token = signingInput + "." +
    encode(
      new Uint8Array(
        await crypto.subtle.sign(
          "RSASSA-PKCS1-v1_5",
          keyPair.privateKey,
          new TextEncoder().encode(signingInput),
        ),
      ),
    );
  const der = new Uint8Array(await crypto.subtle.exportKey("spki", keyPair.publicKey));
  const publicKeyPem = "-----BEGIN PUBLIC KEY-----\n" +
    (btoa(String.fromCharCode(...der)).match(/.{1,64}/g) ?? []).join("\n") +
    "\n-----END PUBLIC KEY-----";
  const env: Record<string, string> = {
    OAUTH_PUBLIC_KEY: publicKeyPem,
    SERVICE_ACCOUNT_VERYFRONT_SERVER_ID: writerContract.payload.serviceAccountId,
    NODE_ENV: "production",
    DENO_TESTING: "1",
  };
  for (const key of ["HOME", "DENO_DIR"]) {
    const value = Deno.env.get(key);
    if (value) env[key] = value;
  }
  const child = new Deno.Command(Deno.execPath(), {
    args: ["eval", "--config", "deno.json", program],
    clearEnv: true,
    env,
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
    signal: AbortSignal.timeout(30000),
  }).spawn();
  const input = child.stdin.getWriter();
  await input.write(
    new TextEncoder().encode(
      JSON.stringify({ token, publicKeyPem, serverId: writerContract.payload.serviceAccountId }),
    ),
  );
  await input.close();
  const output = await child.output();
  assertEquals(output.code, 0, new TextDecoder().decode(output.stderr));
  assertEquals(
    new TextDecoder().decode(output.stdout).trim().split("\n").at(-1),
    "canonical-tool-policy-qualified",
  );
});

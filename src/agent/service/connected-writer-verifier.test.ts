import { createConnectedLocalPlatformTools } from "../ag-ui/connected-local-platform-tools.ts";
import { getActiveRuntimeRemoteToolSources } from "../runtime/remote-tool-source-context.ts";
import { createHostedRunEventWriterCapability } from "../hosted/child-run-event-writer-token.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { executeConfiguredTool } from "../runtime/tool-helpers.ts";
import { tool } from "#veryfront/tool";
import { markTrustedPlatformSource } from "#veryfront/tool/platform-source-provenance.ts";
import "#veryfront/schemas/_test-setup.ts";
import { generateKeyPairSync, sign } from "node:crypto";
import { assertEquals } from "#veryfront/testing/assert.ts";
import {
  createConnectedLocalWriterVerifier,
  createVerifiedPlatformToolDependencyRunner,
  getVerifiedPlatformToolDependencies,
} from "./auth.ts";

it("connected writer admits only API-signed exact-run wrapper dependencies", async () => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const scope = {
    projectId: "22222222-2222-4222-8222-222222222222",
    runId: "run",
    agentId: "agent",
  };
  const dependencies = [{ toolId: "run_usage", platformTools: ["veryfront__get_run"] }];
  const payload = {
    ...scope,
    userId: "server",
    serviceAccountId: "server",
    actorType: "service_account",
    tokenUse: "run_event_writer",
    scopes: ["agent-runs:events:append"],
    exp: Math.floor(Date.now() / 1000) + 60,
    platformToolDependencies: dependencies,
  };
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const signed = (claims: Record<string, unknown>) => {
    const unsigned = `${encode({ alg: "RS256", kid: "key" })}.${encode(claims)}`;
    return `${unsigned}.${
      sign("RSA-SHA256", Buffer.from(unsigned), privateKey).toString("base64url")
    }`;
  };
  const token = signed(payload);
  Deno.env.set("VERYFRONT_API_URL", "http://localhost:4000");
  await withMockFetch(
    async (url, init) =>
      String(url).endsWith("/mcp")
        ? Response.json({
          jsonrpc: "2.0",
          id: JSON.parse(String(init?.body)).id,
          result: { tools: [] },
        })
        : Response.json({
          keys: [{ ...publicKey.export({ format: "jwk" }), kid: "key", alg: "RS256" }],
        }),
    async () => {
      const verify = createConnectedLocalWriterVerifier("http://localhost:4000");
      const result = await verify({ ...scope, token });
      assertEquals(result.verified, true);
      assertEquals(getVerifiedPlatformToolDependencies(result, scope), dependencies);
      assertEquals((await verify({ ...scope, runId: "other", token })).verified, false);
      assertEquals((await verify({ ...scope, agentId: "other", token })).verified, false);
      assertEquals((await verify({ ...scope, projectId: "other", token })).verified, false);
      assertEquals(
        (await verify({ ...scope, token: signed({ ...payload, exp: 1 }) })).verified,
        false,
      );
      assertEquals(
        (await verify({ ...scope, token: signed({ ...payload, scopes: [] }) })).verified,
        false,
      );

      assertEquals(
        (await verify({ ...scope, token: token.slice(0, -4) + "AAAA" })).verified,
        false,
      );
      assertEquals(getVerifiedPlatformToolDependencies({ ...result }, scope), undefined);
      const runner = createVerifiedPlatformToolDependencyRunner(result, scope);
      const source = markTrustedPlatformSource({
        id: "verified-api",
        listTools: async () => [{ name: "veryfront__get_run", description: "", parameters: {} }],
        executeTool: async () => ({ trusted: true }),
      });
      runner.captureSource(source);
      const wrapper = tool({
        id: "run_usage",
        description: "Read signed run usage",
        inputSchema: { type: "object", properties: {} },
        delegatedPlatformTools: ["veryfront__get_run"],
        execute: (_input, context) => context!.executePlatformTool!("veryfront__get_run", {}),
      });
      assertEquals(
        await runner.run(() =>
          executeConfiguredTool(
            "run_usage",
            {},
            { run_usage: wrapper },
            scope,
            undefined,
            [],
          )
        ),
        { trusted: true },
      );
      runner.revoke();
      const connected = createConnectedLocalPlatformTools("http://localhost:4000", fetch);
      const owner = { runId: scope.runId };
      await connected.register(
        owner,
        scope,
        token,
        signed({ ...payload, scope: ["sandboxes:write"] }),
      );
      const writer = createHostedRunEventWriterCapability({
        apiUrl: "http://localhost:4000",
        runId: scope.runId,
        canonicalRunId: "11111111-1111-4111-8111-111111111111",
        runEventAppendToken: token,
      });
      if (!writer) throw new Error("Missing test writer");
      const definitions = await connected.run({
        owner,
        scope,
        writer,
        canonicalRunId: "11111111-1111-4111-8111-111111111111",
        signal: new AbortController().signal,
        admit: () => {
          throw new Error("Discovery must not execute a tool");
        },
      }, async () => {
        const source = getActiveRuntimeRemoteToolSources()![0]!;
        assertEquals(source.id, "veryfront-platform-mcp");
        return await source.listTools(scope);
      });
      const bash = definitions.find((tool) => tool.name === "veryfront__bash");
      assertEquals(bash?.parameters?.properties?.command?.type, "string");
      await connected.revoke(owner);
    },
  );
});

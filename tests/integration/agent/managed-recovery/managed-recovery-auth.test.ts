import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { createControlPlaneSignature } from "#veryfront/server/handlers/request/internal-agent-run.test-helpers.ts";

const program = `
import "#veryfront/schemas/_test-setup.ts";
import { verifyControlPlaneRequest } from "#veryfront/internal-agents/control-plane-auth.ts";
import { getHostBootEnv } from "#veryfront/platform/compat/process/env.ts";
import { createCtx } from "#veryfront/server/handlers/request/internal-agent-run.test-helpers.ts";
const data = JSON.parse(await new Response(Deno.stdin.readable).text());
if (getHostBootEnv("CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY") !== undefined) {
  throw new Error("The production verifier unexpectedly has a pinned boot key");
}
const ctx = createCtx(data.publicKeyPem);
ctx.projectId = data.projectId;
try {
  const claims = await verifyControlPlaneRequest(new Request("https://veryfront.test/api/control-plane/runs/run-1/stream", {
    method: "POST", headers: { "x-veryfront-control-plane-jws": data.jws },
  }), ctx, data.body);
  console.log(JSON.stringify({ accepted: true, subject: claims.sub }));
} catch (error) {
  console.log(JSON.stringify({ accepted: false, status: error.status }));
}
`;

it("a compatibility signature without a pinned boot key cannot downgrade recovery to ordinary execution", async () => {
  for (const recovery of [false, true]) {
    const projectId = "11111111-1111-4111-8111-111111111111";
    const body = JSON.stringify(
      recovery
        ? {
          managedRecoveryAdmission: {
            version: 1,
            identity: {
              projectId,
              canonicalRunId: "22222222-2222-4222-8222-222222222222",
              publicRunId: "run-1",
              agentId: "proof-agent",
              threadId: "77777777-7777-4777-8777-777777777777",
              sourceHash: "a".repeat(64),
            },
            generation: {
              workerId: "worker-0",
              dispatchNonce: "66666666-6666-4666-8666-000000000000",
              transportRecoveryAttempt: 0,
            },
            acknowledgedExternalSequence: 0,
            leaseRemainingMs: 10_000,
            sourceBinding: {
              projectId,
              environmentId: "33333333-3333-4333-8333-333333333333",
              releaseId: "44444444-4444-4444-8444-444444444444",
            },
            eventPersistence: "runtime-owned-v1",
            expiresAt: Math.floor(Date.now() / 1000) + 30,
          },
        }
        : {},
    );
    const signed = await createControlPlaneSignature(body, { projectId, requestId: "run-1" });
    const env: Record<string, string> = { DENO_TESTING: "0", NODE_ENV: "production" };
    const home = Deno.env.get("HOME");
    const cache = Deno.env.get("DENO_DIR");
    if (home) env.HOME = home;
    if (cache) env.DENO_DIR = cache;
    const child = new Deno.Command(Deno.execPath(), {
      args: ["eval", "--config", "deno.json", program],
      clearEnv: true,
      env,
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    }).spawn();
    const writer = child.stdin.getWriter();
    await writer.write(new TextEncoder().encode(JSON.stringify({ body, projectId, ...signed })));
    await writer.close();
    const output = await child.output();
    assertEquals(output.code, 0, new TextDecoder().decode(output.stderr));
    const lines = new TextDecoder().decode(output.stdout).trim().split("\n");
    const result = lines.at(-1);
    if (!result) throw new Error("Production verifier returned no result");
    assertEquals(
      JSON.parse(result),
      recovery ? { accepted: false, status: 401 } : { accepted: true, subject: "run-1" },
    );
  }
});

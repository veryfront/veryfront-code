import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { parseBrokerRuntimeAgentIngress } from "#veryfront/agent/service/broker-ingress.ts";
import { options, signedRequest } from "#veryfront/agent/service/broker-ingress.test-helpers.ts";
import {
  activateHostedAgentPauseCapability,
  getHostedAgentPauseCreationOptions,
  inheritHostedAgentPauseCapability,
} from "#veryfront/agent/hosted/manual-pause-credential.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";

it("carries the signed ingress stop token privately into runtime creation", async () => {
  const signed = await signedRequest();
  signed.request.headers.set("x-veryfront-run-stop-token", "synthetic-stop-token");
  const ingress = await parseBrokerRuntimeAgentIngress(
    signed.request,
    options(signed.publicKeyPem),
  );
  const prepared = {};
  const runtimeOptions = {};
  inheritHostedAgentPauseCapability(prepared, ingress);
  inheritHostedAgentPauseCapability(runtimeOptions, prepared);
  assertEquals(JSON.stringify(ingress).includes("synthetic-stop-token"), false);
  await withMockFetch((url, init) => {
    assertEquals(new URL(String(url)).pathname, "/runs/run-1/pause-checkpoint");
    assertEquals(new Headers(init?.headers).get("Authorization"), "Bearer synthetic-stop-token");
    return Promise.resolve(Response.json({ stop: false, checkpoint: null }));
  }, async () => {
    const pause = activateHostedAgentPauseCapability(runtimeOptions, AbortSignal.timeout(3000));
    assertEquals(pause !== undefined, true);
    assertEquals(getHostedAgentPauseCreationOptions(runtimeOptions), pause);
    assertEquals(await pause!.load(), null);
  });
});

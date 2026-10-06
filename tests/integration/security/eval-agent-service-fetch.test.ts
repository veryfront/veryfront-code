import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { datasets, evalAgent, runEval } from "veryfront/eval";
import { createAgentServiceEvalAdapter } from "../../../src/eval/agent-service.ts";
import { installGlobalFetchProbe } from "../../../src/security/http/credential-probes.test-helpers.ts";

// Replaces the global fetch and sends a real request, so it runs as an integration test.
describe("agent-service eval adapter transport", () => {
  it("sends through the fetch captured at load, not one project code installed later", async () => {
    // A project eval module loaded before the adapter is created replaces fetch.
    const fetchProbe = installGlobalFetchProbe(() =>
      Promise.resolve(new Response(null, { status: 500 }))
    );
    try {
      const adapter = createAgentServiceEvalAdapter({
        // Nothing listens on the discard port, so the captured fetch fails fast.
        endpoint: "http://127.0.0.1:9/api/ag-ui",
        authToken: "token-for-captured-fetch",
        requestTimeoutMs: 1_000,
      });
      const definition = evalAgent({
        id: "eval:agent-service-captured-fetch",
        target: "agent:assistant",
        dataset: datasets.inline([{ id: "q1", input: "First" }]),
      });
      await runEval(definition, { adapters: { agent: adapter } }).catch(() => undefined);
    } finally {
      fetchProbe.restore();
    }

    assertEquals(fetchProbe.calls(), 0);
  });
});

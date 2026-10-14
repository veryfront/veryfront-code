import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  startProvider,
  waitForProviderCancellation,
} from "../../../scripts/test/runtime-inference-critical-flow.ts";
const VALID_WIRE_MODEL = "claude-haiku-4-5-20251001";
const VALID_KEY = "vf-runtime-critical-flow-key";
describe("runtime provider cancellation", () => {
  it("observes child client disconnect before pending response headers and excludes cleanup", async () => {
    for (const abortClient of [true, false]) {
      const provider = await startProvider(
        "agent-marker",
        "workflow-marker",
        "black-hole",
      );
      const clientSource = `
        const controller = new AbortController();
        const pending = fetch(Deno.args[0], {
          method: "POST",
          headers: { "x-api-key": "${VALID_KEY}", "anthropic-version": "2023-06-01", "content-type": "application/json" },
          body: JSON.stringify({ model: "${VALID_WIRE_MODEL}", messages: [{ role: "user", content: "workflow-marker" }] }),
          signal: controller.signal,
        }).then(async response => ({ status: response.status, body: await response.text() }),
          error => ({ aborted: error.name === "AbortError" }));
        await Deno.stdin.read(new Uint8Array(1));
        if (Deno.args[1] === "abort") controller.abort();
        console.log(JSON.stringify(await pending));
      `;
      const child = new Deno.Command(Deno.execPath(), {
        args: [
          "run",
          "--no-config",
          "--no-lock",
          "--allow-net=127.0.0.1",
          `data:application/javascript,${encodeURIComponent(clientSource)}`,
          new URL("messages", provider.url.href + "/").href,
          abortClient ? "abort" : "hold",
        ],
        clearEnv: true,
        stdin: "piped",
        stdout: "piped",
        stderr: "piped",
        signal: AbortSignal.timeout(10_000),
      }).spawn();
      const output = child.output();
      const writer = child.stdin.getWriter();
      try {
        const receiptDeadline = Date.now() + 5_000;
        while (!provider.received.includes("workflow-marker")) {
          if (provider.validationFailure()) throw provider.validationFailure();
          assert(
            Date.now() < receiptDeadline,
            "Child request never reached the provider",
          );
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        await writer.write(new Uint8Array([1]));
        await writer.close();
        if (abortClient) {
          // Use the actual strict harness deadline, with response headers still pending.
          await waitForProviderCancellation(provider, "deno");
        } else {
          await assertRejects(() => waitForProviderCancellation(provider, "deno"));
          assertEquals(provider.cancellationEvidence(), undefined);
        }
      } finally {
        provider.abort();
        await provider.server.shutdown();
        await provider.closed;
        const result = await output;
        assert(result.success, new TextDecoder().decode(result.stderr));
        const observed = JSON.parse(new TextDecoder().decode(result.stdout));
        if (abortClient) assertEquals(observed.aborted, true);
        else {
          assertEquals(provider.cancellationEvidence(), undefined);
        }
      }
    }
  });
});

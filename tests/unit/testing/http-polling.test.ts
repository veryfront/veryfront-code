import { assertEquals } from "#veryfront/testing/assert.ts";
import { pollHttpReadyByTimeout } from "../../_helpers/http-polling.ts";

Deno.test("HTTP readiness polling honors an already-aborted caller", async () => {
  const controller = new AbortController();
  controller.abort(new Error("server exited"));

  const result = await pollHttpReadyByTimeout(
    "http://127.0.0.1:1/readyz",
    {
      timeoutMs: 60_000,
      signal: controller.signal,
    },
  );

  assertEquals(result.ready, false);
  assertEquals(result.attempts, 0);
  assertEquals(result.lastError, null);
});

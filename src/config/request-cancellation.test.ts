import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import {
  createHostedConfigRequestCancellation,
  isHostedConfigRequestCancellation,
} from "#veryfront/config/request-cancellation.ts";
import { createDeclarativeConfigWorkerInfrastructureError } from "#veryfront/config/declarative-evaluator-worker-protocol.ts";
import { withRequestTimeout } from "#veryfront/server/runtime-handler/timeout-manager.ts";

it("retains the worker-aborted error contract without granting unrelated errors cancellation ownership", () => {
  const owned = createHostedConfigRequestCancellation();
  assertEquals(owned.reason, "worker-aborted");
  assertEquals(isHostedConfigRequestCancellation(owned), true);
  assertEquals(
    isHostedConfigRequestCancellation(
      createDeclarativeConfigWorkerInfrastructureError("worker-aborted"),
    ),
    false,
  );
  assertEquals(isHostedConfigRequestCancellation({ ...owned }), false);
  assertEquals(isHostedConfigRequestCancellation(null), false);
});

it("reports an independent worker abort even after the inbound request aborts", async () => {
  const inbound = new AbortController();
  inbound.abort();
  const fault = createDeclarativeConfigWorkerInfrastructureError("worker-aborted");
  const result = await withRequestTimeout(() => Promise.reject(fault), "/", "GET", {
    signal: inbound.signal,
  });
  await result.settled;
  assertEquals(result.response.status, 500);
  assertEquals(result.error, fault);
});

it("reports an owned cancellation when the inbound request has not aborted", async () => {
  const fault = createHostedConfigRequestCancellation();
  const result = await withRequestTimeout(() => Promise.reject(fault), "/", "GET");
  await result.settled;
  assertEquals(result.response.status, 500);
  assertEquals(result.error, fault);
});

it("keeps a request deadline as a 504 when its handler rejects an owned cancellation", async () => {
  const inbound = new AbortController();
  const result = await withRequestTimeout(
    (signal) =>
      new Promise<Response>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(createHostedConfigRequestCancellation()), {
          once: true,
        });
      }),
    "/",
    "GET",
    { signal: inbound.signal, timeoutMs: 5 },
  );
  await result.settled;
  assertEquals(result.response.status, 504);
  assertEquals(result.error, undefined);
  assertEquals(inbound.signal.aborted, false);
});

import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { waitFor } from "#veryfront/testing/deno-compat.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { runWithRequestContext } from "#veryfront/platform/adapters/fs/veryfront/request-context.ts";
import { prepareDeclarativeConfigContext } from "#veryfront/config/declarative-evaluator.ts";
import {
  __getHostedConfigFlightStateForTests,
  __setHostedConfigEvaluatorForTests,
  clearConfigCache,
  getHostedConfig,
} from "#veryfront/config/loader.ts";
import { withRequestTimeout } from "#veryfront/server/runtime-handler/timeout-manager.ts";
import { isExpectedApplicationError } from "#veryfront/observability/application-errors.ts";

it("classifies an inbound request cancellation during a hosted evaluation as cancelled", async () => {
  clearConfigCache();
  const adapter = createMockAdapter();
  Object.assign(adapter.fs, {
    getUnderlyingAdapter: () => adapter.fs,
    isMultiProjectMode: () => true,
    isVeryfrontAdapter: () => true,
    exists: async (path: string) => path === "/veryfront.config.ts",
    readFile: async (path: string) => {
      if (path !== "/veryfront.config.ts") {
        throw Object.assign(new Error("Fixture file absent"), { code: "ENOENT" });
      }
      return 'export default { title: "isolated-cancellation-fixture" };';
    },
  });
  const preparedContext = await prepareDeclarativeConfigContext({
    environmentName: "Production",
    environment: {},
  });
  const started = Promise.withResolvers<void>();
  const resume = Promise.withResolvers<void>();
  const inbound = new AbortController();
  __setHostedConfigEvaluatorForTests(async () => {
    started.resolve();
    await resume.promise;
    return { title: "isolated-cancellation-fixture" };
  });
  try {
    const outcome = withRequestTimeout(
      async (signal) => {
        await runWithRequestContext({
          projectSlug: "isolated-cancellation-fixture",
          projectId: "isolated-cancellation-fixture",
          token: "TEST_ONLY",
          productionMode: true,
          releaseId: "test-release",
          environmentName: "Production",
        }, () =>
          getHostedConfig("/hosted/isolated-cancellation-fixture", adapter, {
            cacheKey: "isolated-cancellation-fixture",
            sourceContext: {
              productionMode: true,
              releaseId: "test-release",
              environmentName: "Production",
            },
            preparedContext,
            signal,
          }));
        return new Response("completed");
      },
      "/",
      "GET",
      { signal: inbound.signal, timeoutMs: 10000 },
    );
    await started.promise;
    await waitFor(() => __getHostedConfigFlightStateForTests().waiters === 1);
    inbound.abort(new DOMException("Client disconnected", "AbortError"));
    const result = await outcome;
    await result.settled;
    console.log(
      JSON.stringify({
        responseStatus: result.response.status,
        errorName: result.error?.name,
        expectedApplicationError: isExpectedApplicationError(result.error),
      }),
    );
    assertEquals(result.response.status, 499);
    assertEquals(result.error, undefined);
  } finally {
    resume.resolve();
    await waitFor(() => __getHostedConfigFlightStateForTests().flights === 0);
    __setHostedConfigEvaluatorForTests();
    clearConfigCache();
  }
});

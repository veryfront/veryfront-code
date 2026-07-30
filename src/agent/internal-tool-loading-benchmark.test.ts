import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { getCurrentRequestContext } from "#veryfront/platform/adapters/fs/veryfront/request-context.ts";
import {
  getVeryfrontCloudAuthToken,
  getVeryfrontCloudProjectSlug,
} from "#veryfront/platform/cloud/resolver.ts";
import { runWithAgentToolLoadingBenchmarkRequestContext } from "./internal-tool-loading-benchmark.ts";

it("scopes internal tool-loading benchmarks to one project and user token", async () => {
  const outsideContext = getCurrentRequestContext();
  const outsideProjectSlug = getVeryfrontCloudProjectSlug();
  const outsideAuthToken = getVeryfrontCloudAuthToken();

  const result = await runWithAgentToolLoadingBenchmarkRequestContext(
    {
      projectSlug: "benchmark-project",
      projectId: "11111111-1111-4111-8111-111111111111",
      authToken: "benchmark-user-token",
    },
    async () => {
      await Promise.resolve();
      const context = getCurrentRequestContext();
      return {
        projectSlug: getVeryfrontCloudProjectSlug(),
        authToken: getVeryfrontCloudAuthToken(),
        projectId: context?.projectId,
        productionMode: context?.productionMode,
      };
    },
  );

  assertEquals(result, {
    projectSlug: "benchmark-project",
    authToken: "benchmark-user-token",
    projectId: "11111111-1111-4111-8111-111111111111",
    productionMode: false,
  });
  assertStrictEquals(getCurrentRequestContext(), outsideContext);
  assertStrictEquals(getVeryfrontCloudProjectSlug(), outsideProjectSlug);
  assertStrictEquals(getVeryfrontCloudAuthToken(), outsideAuthToken);
});

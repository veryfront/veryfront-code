import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { MemoryCacheBackend } from "#veryfront/cache/backend.ts";
import {
  getCachedWithBatching,
  runWithCacheBatching,
} from "#veryfront/cache/request-cache-batcher.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { runWithRequestContext } from "#veryfront/platform/adapters/fs/veryfront/request-context.ts";
import { prepareDeclarativeConfigContext } from "./declarative-evaluator.ts";
import { __getHostedConfigSourceReadStateForTests, getHostedConfig } from "./loader.ts";

Deno.test("hosted config recovers source-read capacity after its creating request aborts", async () => {
  const backend = new MemoryCacheBackend();
  await backend.set("published-source", 'export default { title: "published configuration" };');
  const adapter = createMockAdapter();
  const queued = Promise.withResolvers<void>();
  Object.assign(adapter.fs, {
    getUnderlyingAdapter: () => adapter.fs,
    isMultiProjectMode: () => true,
    isVeryfrontAdapter: () => true,
    readFile: async () => {
      const read = getCachedWithBatching(backend, "published-source");
      queued.resolve();
      const source = await read;
      if (source === null) throw new Error("Published configuration is missing");
      return source;
    },
  });
  const sourceContext = {
    productionMode: true,
    releaseId: "release-request-cancellation",
    environmentName: "Production",
  } as const;
  const preparedContext = await prepareDeclarativeConfigContext({
    environmentName: sourceContext.environmentName,
    environment: {},
  });
  const load = (signal?: AbortSignal) =>
    runWithRequestContext({
      projectId: "project-request-cancellation",
      projectSlug: "project-request-cancellation",
      token: "test-project-token",
      ...sourceContext,
    }, () =>
      getHostedConfig("/hosted/project-request-cancellation", adapter, {
        cacheKey: "project-request-cancellation",
        sourceContext,
        preparedContext,
        signal,
      }));
  const creator = new AbortController();
  const first = runWithCacheBatching(() => load(creator.signal));
  await queued.promise;
  creator.abort();
  await assertRejects(() => first);

  const follower = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const config = await Promise.race([
      load(follower.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Shared configuration read remained blocked")),
          1_000,
        );
      }),
    ]);
    assertEquals(config.title, "published configuration");
    const state = __getHostedConfigSourceReadStateForTests();
    assertEquals([state.active, state.queued, state.flights, state.waiters], [0, 0, 0, 0]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    follower.abort();
  }
});

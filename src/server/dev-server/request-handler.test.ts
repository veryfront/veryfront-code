import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import {
  __destroyRSCHandlerForTests,
  __injectCacheForTests,
  getRSCHandler,
  type HandlerCache,
} from "#veryfront/server/services/rsc/endpoints/handler-registry.ts";
import type { RSCDevServerHandler } from "#veryfront/server/services/rsc/orchestrators/index.ts";
import { RequestHandler } from "./request-handler.ts";

function createHandlerCache(): HandlerCache<RSCDevServerHandler> {
  const entries = new Map<string, RSCDevServerHandler>();
  return {
    get: (key) => entries.get(key),
    set: (key, value) => entries.set(key, value),
    delete: (key) => entries.delete(key),
    clear: () => entries.clear(),
    get size() {
      return entries.size;
    },
  };
}

describe("server/dev-server/request-handler", () => {
  afterEach(() => __destroyRSCHandlerForTests());

  it("invalidates the project RSC handler during file-change invalidation", () => {
    __injectCacheForTests(createHandlerCache());
    const handlerOptions = {
      mode: "development" as const,
      config: { react: { version: "19.1.1" } },
    };
    const before = getRSCHandler("/project/a", "project-a", handlerOptions);
    const requestHandler = new RequestHandler(
      "/project/a",
      {} as RuntimeAdapter,
      () => true,
      () => false,
      undefined,
      undefined,
      "project-a",
    );

    requestHandler.invalidateRuntimeHandler();

    const after = getRSCHandler("/project/a", "project-a", handlerOptions);
    assertEquals(after !== before, true);
  });
});

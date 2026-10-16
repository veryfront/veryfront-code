import { AsyncLocalStorage } from "node:async_hooks";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { createDenoServer } from "#veryfront/platform/adapters/runtime/deno/http-server.ts";

const TEST_ENV_OVERLAY_KEYS = ["__vfTestDenoEnvOverlay", "__vfTestEnvOverlay"] as const;

/**
 * The test runner installs an env overlay whose run() wraps every request
 * handler. Production has no overlay, so create the server without it.
 */
async function createServerWithoutTestEnvOverlay(
  ...args: Parameters<typeof createDenoServer>
): ReturnType<typeof createDenoServer> {
  const globals = globalThis as Record<string, unknown>;
  const saved = TEST_ENV_OVERLAY_KEYS.map((key) => [key, globals[key]] as const);
  for (const key of TEST_ENV_OVERLAY_KEYS) delete globals[key];
  try {
    return await createDenoServer(...args);
  } finally {
    for (const [key, value] of saved) {
      if (value !== undefined) globals[key] = value;
    }
  }
}

Deno.test("Deno server starts each request without stores entered by an earlier request", async () => {
  // A request-scoped store (such as a mandatory run-event sink) entered
  // synchronously by one request must not be visible to later requests.
  const requestStore = new AsyncLocalStorage<string>();
  const observed: Array<string | undefined> = [];
  const server = await createServerWithoutTestEnvOverlay((request) => {
    observed.push(requestStore.getStore());
    if (new URL(request.url).pathname === "/enter") {
      requestStore.enterWith("first-request-sink");
    }
    return new Response("ok");
  }, {
    hostname: "127.0.0.1",
    port: 0,
  });

  try {
    for (const path of ["/enter", "/next", "/next"]) {
      const response = await fetch(`http://127.0.0.1:${server.addr.port}${path}`);
      assertEquals(response.status, 200);
      await response.text();
    }
    assertEquals(observed, [undefined, undefined, undefined]);
  } finally {
    await server.stop();
  }
});

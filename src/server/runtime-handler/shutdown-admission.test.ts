import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterAll, afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { setServerInitialized } from "../handlers/monitoring/health.handler.ts";
import { __resetServerShuttingDownForTests, markServerShuttingDown } from "../shutdown-state.ts";
import { createVeryfrontHandler } from "./index.ts";
import { requestTracker } from "./request-tracker.ts";

function createHandler() {
  return createVeryfrontHandler("/shutdown-admission", createMockAdapter(), {
    projectDir: "/shutdown-admission",
    config: { fs: { veryfront: { proxyMode: true } } } as VeryfrontConfig,
  });
}

describe("runtime shutdown admission", () => {
  afterEach(() => {
    __resetServerShuttingDownForTests();
    setServerInitialized(false);
  });
  afterAll(() => requestTracker.shutdown());

  it("rejects new tenant work before resolving project identity while draining", async () => {
    const handler = createHandler();
    markServerShuttingDown();

    for (
      const [method, path] of [
        ["GET", "/"],
        ["GET", "/page?_rsc=1"],
        ["POST", "/api/orders"],
        ["POST", "/api/control-plane/runs/test-run/execute"],
        ["POST", "/channels/invoke"],
        ["GET", "/_vf_modules/page.js"],
      ]
    ) {
      // No tenant identity or authorization is needed to reject work before
      // project resolution and dispatch can perform side effects.
      const response = await handler(new Request(`http://localhost${path}`, { method }));
      assertEquals(response.status, 503, `${method} ${path}`);
      assertEquals(response.headers.get("Connection"), "close");
      assertEquals(await response.json(), {
        code: "RUNTIME_SHUTTING_DOWN",
        message: "Runtime is shutting down; retry against another instance",
      });
    }
  });

  it("rejects work when shutdown begins during asynchronous project preparation", async () => {
    const handler = createHandler();
    const responsePromise = handler(new Request("http://localhost/api/orders"));
    markServerShuttingDown();

    const response = await responsePromise;
    assertEquals(response.status, 503);
    assertEquals((await response.json()).code, "RUNTIME_SHUTTING_DOWN");
  });

  it("keeps kubelet probes reachable during drain without exempting tenant methods", async () => {
    const handler = createHandler();
    setServerInitialized(true);
    const readyBefore = await handler(new Request("http://localhost/readyz"));
    assertEquals(readyBefore.status, 200);
    await readyBefore.body?.cancel();

    markServerShuttingDown();
    setServerInitialized(false);

    for (const method of ["GET", "HEAD"]) {
      for (const [path, expectedStatus] of [["/healthz", 200], ["/readyz", 503]] as const) {
        const response = await handler(new Request(`http://localhost${path}`, { method }));
        assertEquals(response.status, expectedStatus, `${method} ${path}`);
        await response.body?.cancel();
      }
    }

    for (
      const [method, path] of [
        ["POST", "/healthz"],
        ["POST", "/readyz"],
        ["GET", "/_health"],
      ]
    ) {
      const response = await handler(new Request(`http://localhost${path}`, { method }));
      assertEquals(response.status, 503);
      assertEquals((await response.json()).code, "RUNTIME_SHUTTING_DOWN");
    }
  });

  it("preserves normal project admission while the process is not draining", async () => {
    const response = await createHandler()(new Request("http://localhost/api/orders"));
    assertEquals(response.status, 502, "normal proxy identity validation still runs");
    await response.body?.cancel();
  });
});

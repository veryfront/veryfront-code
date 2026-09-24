import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { startLoopbackCallbackServer } from "../../../../cli/shared/loopback-callback-server.ts";
import { createIntegrationCallbackHandler } from "../../../../cli/commands/integration/callback.ts";

describe("integration loopback receiver", () => {
  it("ignores a stale callback, accepts the exact identity, then refuses replay", async () => {
    const server = await startLoopbackCallbackServer({
      handle: createIntegrationCallbackHandler({
        nonce: "nonce",
        integration: "github",
        projectId: "project",
        scope: "user",
      }),
    }, 0);
    try {
      const url = new URL(
        `http://127.0.0.1:${server.port}/callback?state=old&integration=github&project_id=project&scope=user&oauth_connected=github`,
      );
      const stale = await fetch(url);
      assertEquals(stale.status, 400);
      await stale.text();
      url.searchParams.set("state", "nonce");
      const wait = server.waitForCallback(5000);
      const response = await fetch(url);
      assertEquals(response.status, 200);
      await response.text();
      assertEquals(await wait, { status: "received" });
      const replay = await fetch(url);
      assertEquals(replay.status, 410);
      await replay.text();
    } finally {
      await server.stop();
    }
  });
  it("aborts and releases its listener without an outstanding timeout", async () => {
    const server = await startLoopbackCallbackServer({
      handle: () => ({ response: new Response("invalid", { status: 400 }) }),
    }, 0);
    try {
      const controller = new AbortController();
      const wait = server.waitForCallback(30000, controller.signal);
      controller.abort(new DOMException("cancelled", "AbortError"));
      await assertRejects(() => wait, DOMException, "cancelled");
    } finally {
      await server.stop();
    }
  });
});

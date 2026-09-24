import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { startCallbackServer } from "../../../../cli/auth/callback-server.ts";
import { startLoopbackCallbackServer } from "../../../../cli/shared/loopback-callback-server.ts";

describe("callback response flush before completion", () => {
  it("delivers the legacy login success body when the caller stops immediately", async () => {
    const server = await startCallbackServer(0, { expectedState: "nonce" });
    try {
      const completion = server.waitForCallback(5000).then(async (result) => {
        await server.stop();
        return result;
      });
      const response = await fetch(
        `http://127.0.0.1:${server.port}/callback?state=nonce&token=synthetic-token`,
      );
      const body = await response.text();
      assertEquals(response.status, 200);
      assertEquals(body.includes("Logged in"), true);
      assertEquals((await completion).token, "synthetic-token");
    } finally {
      await server.stop();
    }
  });
  it("flushes an asynchronously produced response before resolving callback completion", async () => {
    const body = "callback-success".repeat(10000);
    const server = await startLoopbackCallbackServer({
      handle: () => ({
        response: new Response(
          new ReadableStream({
            start(controller) {
              setTimeout(() => {
                controller.enqueue(new TextEncoder().encode(body));
                controller.close();
              }, 20);
            },
          }),
        ),
        result: "received",
      }),
    }, 0);
    try {
      const completion = server.waitForCallback(5000).then(async (result) => {
        await server.stop();
        return result;
      });
      const response = await fetch(`http://127.0.0.1:${server.port}/callback`);
      assertEquals(await response.text(), body);
      assertEquals(await completion, "received");
    } finally {
      await server.stop();
    }
  });
});

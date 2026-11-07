import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createHandler } from "veryfront/server";
import { DenoAdapter } from "#veryfront/platform/adapters/runtime/deno/adapter.ts";
import { withTestContext } from "../../_helpers/context.ts";

// Both public wrappers must preserve the transport-owned upgrade object.
describe("public handler Deno WebSocket transport", () => {
  for (const mode of ["development", "production"] as const) {
    it(`upgrades through the ${mode} public handler`, async () => {
      await withTestContext(`public-handler-websocket-${mode}`, async (context) => {
        const handler = await createHandler({
          mode,
          projectDir: context.projectDir,
          port: await context.allocatePort(),
        });
        const adapter = new DenoAdapter();
        const server = await adapter.serve(handler, { hostname: "127.0.0.1", port: 0 });
        const socket = new WebSocket(`ws://127.0.0.1:${server.addr.port}/_ws`);
        try {
          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(
              () => reject(new Error("WebSocket handshake timed out")),
              5000,
            );
            socket.addEventListener("message", (event) => {
              clearTimeout(timeout);
              try {
                assertEquals(JSON.parse(event.data), { type: "connected" });
                resolve();
              } catch (error) {
                reject(error);
              }
            }, { once: true });
            socket.addEventListener("close", () => {
              clearTimeout(timeout);
              reject(new Error("WebSocket closed before the connected frame"));
            }, { once: true });
            socket.addEventListener("error", () => {
              clearTimeout(timeout);
              reject(new Error("Public handler WebSocket handshake failed"));
            }, { once: true });
          });
          assertEquals(socket.readyState, WebSocket.OPEN);
          const closed = new Promise<void>((resolve) =>
            socket.addEventListener("close", () => resolve(), { once: true })
          );
          socket.close();
          await closed;
        } finally {
          if (socket.readyState < WebSocket.CLOSING) socket.close();
          await server.stop();
          await handler.dispose();
          await adapter.shutdown();
        }
      });
    });
  }
});

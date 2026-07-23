import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withTempDir } from "#veryfront/testing/deno-compat.ts";
import { HMR_MAX_MESSAGE_SIZE_BYTES } from "#veryfront/utils";
import {
  getClientCount,
  HMR_MAX_CLIENTS_PER_SCOPE,
} from "./handlers/preview/hmr-client-manager.ts";
import { createHandler } from "./index.ts";

class MockHmrSocket {
  readyState: number = WebSocket.OPEN;
  readonly sent: string[] = [];
  readonly closed: Array<{ code?: number; reason?: string }> = [];
  private readonly listeners = new Map<string, Set<EventListener>>();

  send(data: string | ArrayBuffer): void {
    this.sent.push(String(data));
  }

  close(code?: number, reason?: string): void {
    this.closed.push({ code, reason });
    this.readyState = WebSocket.CLOSED;
    this.emit("close", new Event("close"));
  }

  addEventListener(type: string, listener: EventListener): void {
    let listeners = this.listeners.get(type);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(type, listeners);
    }
    listeners.add(listener);
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string, event: Event): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
  }

  listenerCount(): number {
    let count = 0;
    for (const listeners of this.listeners.values()) count += listeners.size;
    return count;
  }
}

describe("createHandler lifecycle", { sanitizeOps: false, sanitizeResources: false }, () => {
  it("returns an idempotent disposer in production mode", async () => {
    await withTempDir(async (projectDir) => {
      const handler = await createHandler({ projectDir, mode: "production" });
      assertEquals(typeof handler.dispose, "function");
      await Promise.all([handler.dispose(), handler.dispose()]);
      await handler.dispose();
    }, { prefix: "vf-production-handler-lifecycle-" });
  });

  it("returns an idempotent disposer in development mode", async () => {
    await withTempDir(async (projectDir) => {
      const handler = await createHandler({
        projectDir,
        mode: "development",
        port: 30_334,
      });
      assertEquals(typeof handler.dispose, "function");
      await Promise.all([handler.dispose(), handler.dispose()]);
      await handler.dispose();
    }, { prefix: "vf-development-handler-lifecycle-" });
  });

  it("does not retain rejected or policy-closed direct HMR sockets", async () => {
    await withTempDir(async (projectDir) => {
      const handler = await createHandler({
        projectDir,
        mode: "development",
        port: 30_335,
      });
      try {
        const accepted: MockHmrSocket[] = [];
        for (let index = 0; index < HMR_MAX_CLIENTS_PER_SCOPE; index++) {
          const socket = new MockHmrSocket();
          accepted.push(socket);
          handler.connectHMR(socket as unknown as WebSocket);
        }

        const rejected = new MockHmrSocket();
        handler.connectHMR(rejected as unknown as WebSocket);
        assertEquals(rejected.closed, [{ code: 1013, reason: "Server busy" }]);
        assertEquals(rejected.sent, []);
        assertEquals(rejected.listenerCount(), 0);

        const policyClosed = accepted[0];
        assert(policyClosed);
        policyClosed.emit(
          "message",
          new MessageEvent("message", {
            data: "x".repeat(HMR_MAX_MESSAGE_SIZE_BYTES + 1),
          }),
        );
        assertEquals(policyClosed.listenerCount(), 0);
        assertEquals(getClientCount({ projectDir }), HMR_MAX_CLIENTS_PER_SCOPE - 1);
      } finally {
        await handler.dispose();
      }
    }, { prefix: "vf-development-handler-hmr-lifecycle-" });
  });
});

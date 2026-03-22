import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { addClient, clearAll } from "./hmr-client-manager.ts";
import { broadcastUpdate, resetMetrics } from "./hmr-message-router.ts";

class MockSocket {
  readonly sent: string[] = [];
  readyState: number = WebSocket.OPEN;

  send(message: string): void {
    this.sent.push(message);
  }

  close(): void {
    this.readyState = WebSocket.CLOSED;
  }
}

describe("server/handlers/preview/hmr-message-router", () => {
  afterEach(() => {
    clearAll();
    resetMetrics();
  });

  it("includes preview stylesheet metadata on update messages", () => {
    const socket = new MockSocket();
    addClient({
      id: "client-1",
      socket: socket as unknown as WebSocket,
      connectedAt: Date.now(),
      lastActivity: Date.now(),
      projectSlug: "demo-project",
    });

    broadcastUpdate(["app/page.tsx"], {
      projectSlug: "demo-project",
      styleArtifactHash: "hash-1",
      styleAssetPath: "/_vf/css/hash-1.css",
    });

    assertEquals(socket.sent.length, 1);
    assertEquals(
      JSON.parse(socket.sent[0] ?? ""),
      {
        type: "update",
        path: "app/page.tsx",
        timestamp: JSON.parse(socket.sent[0] ?? "").timestamp,
        styleHash: "hash-1",
        styleHref: "/_vf/css/hash-1.css",
      },
    );
  });
});

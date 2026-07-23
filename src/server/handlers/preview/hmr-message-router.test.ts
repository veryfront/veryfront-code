import "#veryfront/schemas/_test-setup.ts";
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

  addEventListener(): void {}

  removeEventListener(): void {}
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
      socket,
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

  it("sends scoped updates only to the target project and unscoped external clients", () => {
    const target = new MockSocket();
    const otherProject = new MockSocket();
    const external = new MockSocket();
    const now = Date.now();
    addClient({
      id: "target",
      socket: target,
      connectedAt: now,
      lastActivity: now,
      projectSlug: "target-project",
    });
    addClient({
      id: "other",
      socket: otherProject,
      connectedAt: now,
      lastActivity: now,
      projectSlug: "other-project",
    });
    addClient({
      id: "external",
      socket: external,
      connectedAt: now,
      lastActivity: now,
    });

    broadcastUpdate(["app/page.tsx"], { projectSlug: "target-project" });

    assertEquals(target.sent.length, 1);
    assertEquals(external.sent.length, 1);
    assertEquals(otherProject.sent.length, 0);
  });
});

import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  addClient,
  clearAll,
  closeIdleClients,
  getClient,
  getClientCount,
  getOpenSockets,
  HMR_MAX_CLIENTS,
  HMR_MAX_CLIENTS_PER_SCOPE,
  HMR_MAX_SCOPE_VALUE_BYTES,
} from "./hmr-client-manager.ts";

class MockSocket {
  readyState: number = WebSocket.OPEN;
  closed: Array<{ code?: number; reason?: string }> = [];

  send(): void {}

  close(code?: number, reason?: string): void {
    this.closed.push({ code, reason });
    this.readyState = WebSocket.CLOSED;
  }

  addEventListener(): void {}

  removeEventListener(): void {}
}

describe("server/handlers/preview/hmr-client-manager", () => {
  afterEach(() => clearAll());

  it("filters sockets by project identity", () => {
    const first = new MockSocket();
    const second = new MockSocket();
    addClient({
      id: "first",
      socket: first,
      connectedAt: 1,
      lastActivity: 1,
      projectSlug: "project-a",
      projectDir: "project-a",
    });
    addClient({
      id: "second",
      socket: second,
      connectedAt: 1,
      lastActivity: 1,
      projectSlug: "project-b",
      projectDir: "project-b",
    });

    assertEquals(getOpenSockets({ projectSlug: "project-a" }), [first]);
    assertEquals(getOpenSockets({ projectDir: "project-b" }), [second]);
  });

  it("closes and removes clients that exceed the idle bound", () => {
    const idle = new MockSocket();
    const active = new MockSocket();
    addClient({ id: "idle", socket: idle, connectedAt: 1, lastActivity: 1 });
    addClient({ id: "active", socket: active, connectedAt: 1, lastActivity: 90 });

    assertEquals(closeIdleClients(100, 20), 1);
    assertEquals(idle.closed, [{ code: 1001, reason: "Idle timeout" }]);
    assertEquals(active.closed, []);
    assertEquals(getOpenSockets(), [active]);
  });

  it("rejects connections after a project scope reaches its bound", () => {
    for (let index = 0; index < HMR_MAX_CLIENTS_PER_SCOPE; index++) {
      assert(
        addClient({
          id: `client-${index}`,
          socket: new MockSocket(),
          connectedAt: 1,
          lastActivity: 1,
          projectDir: "project-a",
        }),
      );
    }

    const rejected = new MockSocket();
    assertEquals(
      addClient({
        id: "one-too-many",
        socket: rejected,
        connectedAt: 1,
        lastActivity: 1,
        projectDir: "project-a",
      }),
      false,
    );
    assertEquals(getClientCount({ projectDir: "project-a" }), HMR_MAX_CLIENTS_PER_SCOPE);
    assertEquals(rejected.closed, [{ code: 1013, reason: "Server busy" }]);
  });

  it("enforces the global client bound across distinct scopes", () => {
    for (let index = 0; index < HMR_MAX_CLIENTS; index++) {
      assert(
        addClient({
          id: `client-${index}`,
          socket: new MockSocket(),
          connectedAt: 1,
          lastActivity: 1,
          projectDir: `project-${index}`,
        }),
      );
    }

    const rejected = new MockSocket();
    assertEquals(
      addClient({
        id: "one-too-many",
        socket: rejected,
        connectedAt: 1,
        lastActivity: 1,
        projectDir: "another-project",
      }),
      false,
    );
    assertEquals(getClientCount(), HMR_MAX_CLIENTS);
    assertEquals(rejected.closed, [{ code: 1013, reason: "Server busy" }]);
  });

  it("rejects oversized routing metadata and never stores user-agent data", () => {
    const oversized = new MockSocket();
    assertEquals(
      addClient({
        id: "oversized",
        socket: oversized,
        connectedAt: 1,
        lastActivity: 1,
        projectSlug: "å".repeat(HMR_MAX_SCOPE_VALUE_BYTES),
      }),
      false,
    );
    assertEquals(oversized.closed, [{ code: 1008, reason: "Invalid client metadata" }]);

    assert(
      addClient({
        id: "bounded",
        socket: new MockSocket(),
        connectedAt: 1,
        lastActivity: 1,
        projectSlug: "project-a",
        userAgent: "private-user-agent",
      }),
    );
    assertEquals(getClient("bounded")?.userAgent, undefined);
  });
});

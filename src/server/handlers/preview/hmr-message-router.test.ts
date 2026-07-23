import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  __registerLogRecordEmitter,
  __resetLoggerConfigForTests,
  __resetLogRecordEmitterForTests,
  type LogEntry,
} from "#veryfront/utils/logger/logger.ts";
import { addClient, clearAll, getClientCount } from "./hmr-client-manager.ts";
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
    __resetLogRecordEmitterForTests();
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

  it("does not forward a stylesheet URL outside the internal asset route", () => {
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
      styleAssetPath: "https://untrusted.invalid/styles.css",
    });

    const update = JSON.parse(socket.sent[0] ?? "") as Record<string, unknown>;
    assertEquals("styleHref" in update, false);
    assertEquals("styleHash" in update, false);
  });

  it("routes a local project update only to clients from that project", () => {
    const firstProject = new MockSocket();
    const secondProject = new MockSocket();
    addClient({
      id: "project-a-client",
      socket: firstProject,
      connectedAt: Date.now(),
      lastActivity: Date.now(),
      projectDir: "project-a",
    });
    addClient({
      id: "project-b-client",
      socket: secondProject,
      connectedAt: Date.now(),
      lastActivity: Date.now(),
      projectDir: "project-b",
    });

    broadcastUpdate(["app/page.tsx"], { projectDir: "project-a" });

    assertEquals(firstProject.sent.length, 1);
    assertEquals(secondProject.sent.length, 0);
  });

  it("keeps preview branch updates inside their environment and branch", () => {
    const mainBranch = new MockSocket();
    const featureBranch = new MockSocket();
    addClient({
      id: "main-branch-client",
      socket: mainBranch,
      connectedAt: Date.now(),
      lastActivity: Date.now(),
      projectId: "project-id",
      projectSlug: "project",
      environment: "preview",
      branch: "main",
    });
    addClient({
      id: "feature-branch-client",
      socket: featureBranch,
      connectedAt: Date.now(),
      lastActivity: Date.now(),
      projectId: "project-id",
      projectSlug: "project",
      environment: "preview",
      branch: "feature",
    });

    broadcastUpdate(["app/page.tsx"], {
      projectId: "project-id",
      projectSlug: "project",
      environment: "preview",
      branch: "main",
    });

    assertEquals(mainBranch.sent.length, 1);
    assertEquals(featureBranch.sent.length, 0);
  });

  it("does not turn incomplete project metadata into a global broadcast", () => {
    const firstProject = new MockSocket();
    const secondProject = new MockSocket();
    addClient({
      id: "project-a-client",
      socket: firstProject,
      connectedAt: Date.now(),
      lastActivity: Date.now(),
      projectDir: "project-a",
      environment: "preview",
    });
    addClient({
      id: "project-b-client",
      socket: secondProject,
      connectedAt: Date.now(),
      lastActivity: Date.now(),
      projectDir: "project-b",
      environment: "preview",
    });

    broadcastUpdate(["app/page.tsx"], { environment: "preview" });

    assertEquals(firstProject.sent, []);
    assertEquals(secondProject.sent, []);
  });

  it("removes a client whose socket throws during broadcast", () => {
    const socket = new MockSocket();
    socket.send = () => {
      throw new Error("private transport detail");
    };
    addClient({
      id: "failing-client",
      socket,
      connectedAt: Date.now(),
      lastActivity: Date.now(),
      projectDir: "project-a",
    });

    broadcastUpdate(["app/page.tsx"], { projectDir: "project-a" });

    assertEquals(getClientCount(), 0);
    assertEquals(socket.readyState, WebSocket.CLOSED);
  });

  it("does not write project identifiers, paths, or raw errors to logs", () => {
    const previousLogLevel = Deno.env.get("LOG_LEVEL");
    const entries: LogEntry[] = [];
    Deno.env.set("LOG_LEVEL", "DEBUG");
    __resetLoggerConfigForTests();
    __registerLogRecordEmitter((entry) => entries.push(entry));

    try {
      const socket = new MockSocket();
      socket.send = () => {
        throw new Error("private-hmr-error-canary");
      };
      addClient({
        id: "private-client-canary",
        socket,
        connectedAt: Date.now(),
        lastActivity: Date.now(),
        projectSlug: "private-project-canary",
      });

      broadcastUpdate(["private/path-canary.tsx"], {
        projectSlug: "private-project-canary",
        styleAssetPath: "/private-style-canary.css",
      });

      const serialized = JSON.stringify(entries);
      for (
        const privateValue of [
          "private-client-canary",
          "private-project-canary",
          "private/path-canary.tsx",
          "/private-style-canary.css",
          "private-hmr-error-canary",
        ]
      ) {
        assertEquals(serialized.includes(privateValue), false);
      }
    } finally {
      if (previousLogLevel === undefined) Deno.env.delete("LOG_LEVEL");
      else Deno.env.set("LOG_LEVEL", previousLogLevel);
      __resetLoggerConfigForTests();
    }
  });
});

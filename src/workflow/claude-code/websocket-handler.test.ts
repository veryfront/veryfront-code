import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createWebSocketHandler } from "./websocket-publisher.ts";

class MockSocket extends EventTarget {
  readyState: number = WebSocket.OPEN;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  closeCalls = 0;

  send(_message: string): void {}

  close(): void {
    if (this.readyState === WebSocket.CLOSED) return;
    this.closeCalls++;
    this.readyState = WebSocket.CLOSED;
    const event = new CloseEvent("close");
    this.onclose?.(event);
    this.dispatchEvent(event);
  }

  open(): void {
    const event = new Event("open");
    this.onopen?.(event);
    this.dispatchEvent(event);
  }
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("workflow/claude-code/createWebSocketHandler", () => {
  it("closes a connection whose async setup fails and still runs close cleanup", async () => {
    const originalUpgrade = Deno.upgradeWebSocket;
    const socket = new MockSocket();
    let closeCalls = 0;
    Deno.upgradeWebSocket = (() => ({
      socket: socket as unknown as WebSocket,
      response: new Response(null, { status: 200 }),
    })) as typeof Deno.upgradeWebSocket;

    try {
      const handler = createWebSocketHandler({
        getRunId: () => "run-1",
        onConnection: () => Promise.reject(new Error("setup failed")),
        onClose: () => {
          closeCalls++;
        },
      });

      handler(new Request("https://example.com/workflows"));
      socket.open();
      await settle();

      assertEquals(socket.closeCalls, 1);
      assertEquals(closeCalls, 1);
    } finally {
      Deno.upgradeWebSocket = originalUpgrade;
    }
  });

  it("contains rejected async close cleanup", async () => {
    const originalUpgrade = Deno.upgradeWebSocket;
    const socket = new MockSocket();
    Deno.upgradeWebSocket = (() => ({
      socket: socket as unknown as WebSocket,
      response: new Response(null, { status: 200 }),
    })) as typeof Deno.upgradeWebSocket;

    try {
      const handler = createWebSocketHandler({
        getRunId: () => "run-1",
        onConnection: () => {},
        onClose: () => Promise.reject(new Error("cleanup failed")),
      });

      handler(new Request("https://example.com/workflows"));
      socket.open();
      socket.close();
      await settle();

      assertEquals(socket.closeCalls, 1);
    } finally {
      Deno.upgradeWebSocket = originalUpgrade;
    }
  });

  it("aborts setup and invokes a late connection disposer after an early close", async () => {
    const originalUpgrade = Deno.upgradeWebSocket;
    const socket = new MockSocket();
    let resolveSetup: ((disposer: () => void) => void) | undefined;
    let setupSignal: AbortSignal | undefined;
    let disposerCalls = 0;
    let closeCalls = 0;
    Deno.upgradeWebSocket = (() => ({
      socket: socket as unknown as WebSocket,
      response: new Response(null, { status: 200 }),
    })) as typeof Deno.upgradeWebSocket;

    try {
      const handler = createWebSocketHandler({
        getRunId: () => "run-1",
        onConnection: (_publisher, _runId, context) => {
          setupSignal = context.signal;
          return new Promise<() => void>((resolve) => {
            resolveSetup = resolve;
          });
        },
        onClose: () => {
          closeCalls++;
        },
      });

      handler(new Request("https://example.com/workflows"));
      socket.open();
      socket.close();
      assertEquals(setupSignal?.aborted, true);

      resolveSetup?.(() => disposerCalls++);
      await settle();
      await settle();

      assertEquals(disposerCalls, 1);
      assertEquals(closeCalls, 1);
    } finally {
      Deno.upgradeWebSocket = originalUpgrade;
    }
  });

  it("invokes the owned connection disposer exactly once on close", async () => {
    const originalUpgrade = Deno.upgradeWebSocket;
    const socket = new MockSocket();
    let disposerCalls = 0;
    Deno.upgradeWebSocket = (() => ({
      socket: socket as unknown as WebSocket,
      response: new Response(null, { status: 200 }),
    })) as typeof Deno.upgradeWebSocket;

    try {
      const handler = createWebSocketHandler({
        getRunId: () => "run-1",
        onConnection: () => () => {
          disposerCalls++;
        },
      });

      handler(new Request("https://example.com/workflows"));
      socket.open();
      await settle();
      socket.close();
      socket.close();
      await settle();

      assertEquals(disposerCalls, 1);
    } finally {
      Deno.upgradeWebSocket = originalUpgrade;
    }
  });
});

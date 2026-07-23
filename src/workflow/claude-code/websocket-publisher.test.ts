import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { AgentController, WebSocketPublisher } from "./websocket-publisher.ts";
import type {
  BidirectionalPublisher,
  ClaudeCodeEvent,
  ClaudeCodeEventExtended,
  ClientCommand,
  ClientCommandHandler,
} from "./types.ts";

class MockSocket extends EventTarget {
  readyState = 1;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readonly sent: string[] = [];

  send(message: string): void {
    this.sent.push(message);
  }

  close(): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.emitClose();
  }

  emitMessage(data: string): void {
    const event = new MessageEvent("message", { data });
    this.onmessage?.(event);
    this.dispatchEvent(event);
  }

  emitClose(): void {
    const event = new CloseEvent("close");
    this.onclose?.(event);
    this.dispatchEvent(event);
  }
}

class MockPublisher implements BidirectionalPublisher {
  readonly handlers = new Set<ClientCommandHandler>();
  readonly sent: ClaudeCodeEventExtended[] = [];
  sendResult: void | Promise<void> = undefined;
  unsubscribeError: Error | null = null;

  onCommand(handler: ClientCommandHandler): () => void {
    this.handlers.add(handler);
    return () => {
      if (this.unsubscribeError) throw this.unsubscribeError;
      this.handlers.delete(handler);
    };
  }

  send(event: ClaudeCodeEventExtended): void | Promise<void> {
    this.sent.push(event);
    return this.sendResult;
  }

  publish(event: ClaudeCodeEvent): void {
    this.sent.push(event);
  }

  close(): void {
    this.handlers.clear();
  }

  emit(command: ClientCommand): void {
    for (const handler of this.handlers) handler(command);
  }
}

async function settlementWithin(
  promise: Promise<unknown>,
  timeoutMs = 100,
): Promise<"resolved" | "rejected" | "timeout"> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timeoutId = setTimeout(() => resolve("timeout"), timeoutMs);
  });

  try {
    return await Promise.race([
      promise.then(() => "resolved" as const, () => "rejected" as const),
      timeout,
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

describe("workflow/claude-code/websocket-publisher", () => {
  it("preserves existing socket handlers and releases command subscriptions on close", () => {
    const socket = new MockSocket();
    let externalCloseCalls = 0;
    socket.onclose = () => externalCloseCalls++;

    const publisher = new WebSocketPublisher({
      socket: socket as unknown as WebSocket,
      runId: "run-1",
      pingInterval: 0,
    });
    let commandCalls = 0;
    publisher.onCommand(() => {
      commandCalls++;
    });

    socket.emitMessage(JSON.stringify({ type: "cancel", reason: "stop" }));
    assertEquals(commandCalls, 1);

    socket.readyState = WebSocket.CLOSED;
    socket.emitClose();
    socket.emitMessage(JSON.stringify({ type: "cancel", reason: "again" }));

    assertEquals(externalCloseCalls, 1);
    assertEquals(commandCalls, 1);
    assertEquals(publisher.isOpen, false);
  });

  it("settles pending operations and unsubscribes when the controller is disposed", async () => {
    const publisher = new MockPublisher();
    const controller = new AgentController(publisher);

    const approval = controller.requestApproval(
      "tool-call-1",
      "write_file",
      {},
      "Changes a file",
    );
    const input = controller.requestInput("Continue?");

    assertEquals(publisher.handlers.size, 1);
    controller.dispose();

    const [approvalStatus, inputStatus] = await Promise.all([
      settlementWithin(approval),
      settlementWithin(input),
    ]);
    assertEquals(approvalStatus, "rejected");
    assertEquals(inputStatus, "rejected");
    assertEquals(publisher.handlers.size, 0);
  });

  it("settles pending operations even when command unsubscribe throws", async () => {
    const publisher = new MockPublisher();
    publisher.unsubscribeError = new Error("unsubscribe failed");
    const controller = new AgentController(publisher);
    const approval = controller.requestApproval(
      "tool-call-1",
      "write_file",
      {},
      "Changes a file",
    );
    const input = controller.requestInput("Continue?");

    controller.dispose();

    assertEquals(await settlementWithin(approval), "rejected");
    assertEquals(await settlementWithin(input), "rejected");
  });

  it("rejects a request when an asynchronous publisher send fails", async () => {
    const publisher = new MockPublisher();
    publisher.sendResult = Promise.reject(new Error("send failed"));
    const controller = new AgentController(publisher, { inputTimeout: 1_000 });

    const input = controller.requestInput("Continue?");

    assertEquals(await settlementWithin(input, 50), "rejected");
    controller.dispose();
  });

  it("rejects duplicate active approval IDs without orphaning the first request", async () => {
    const publisher = new MockPublisher();
    const controller = new AgentController(publisher, { approvalTimeout: 40 });
    const first = controller.requestApproval("tool-call-1", "write_file", {}, "First");
    const duplicate = controller.requestApproval(
      "tool-call-1",
      "write_file",
      {},
      "Duplicate",
    );

    assertEquals(await settlementWithin(duplicate, 20), "rejected");
    publisher.emit({
      type: "approve",
      timestamp: Date.now(),
      runId: "run-1",
      toolCallId: "tool-call-1",
    });
    assertEquals(await first, true);
    controller.dispose();
  });

  it("uses injected socket state without requiring a global WebSocket constructor", () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "WebSocket");
    const socket = new MockSocket();

    try {
      delete (globalThis as Record<string, unknown>).WebSocket;
      const publisher = new WebSocketPublisher({
        socket: socket as unknown as WebSocket,
        runId: "run-1",
        pingInterval: 0,
      });

      assertEquals(publisher.isOpen, true);
      publisher.close();
      assertEquals(socket.readyState, 3);
    } finally {
      if (descriptor) Object.defineProperty(globalThis, "WebSocket", descriptor);
    }
  });
});

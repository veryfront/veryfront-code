import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type {
  BidirectionalPublisher,
  ClaudeCodeEvent,
  ClaudeCodeEventExtended,
  ClientCommand,
  ClientCommandDisposition,
  ClientCommandHandler,
} from "./types.ts";
import { AgentController, WebSocketPublisher } from "./websocket-publisher.ts";

class FakePublisher implements BidirectionalPublisher {
  readonly events: ClaudeCodeEventExtended[] = [];
  private handlers = new Set<ClientCommandHandler>();

  get subscriberCount(): number {
    return this.handlers.size;
  }

  emit(
    command: ClientCommand,
  ): Array<ClientCommandDisposition | void | Promise<ClientCommandDisposition | void>> {
    return [...this.handlers].map((handler) => handler(command));
  }

  onCommand(handler: ClientCommandHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  send(event: ClaudeCodeEventExtended): void {
    this.events.push(event);
  }

  publish(event: ClaudeCodeEvent): void {
    this.send(event);
  }

  close(): void {
    this.handlers.clear();
  }
}

class FakeWebSocket {
  readyState: number = WebSocket.OPEN;
  readonly sent: string[] = [];
  private listeners = new Map<string, Array<(event: Event) => void>>();

  addEventListener(type: string, listener: (event: Event) => void): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  emit(type: string, event: Event = new Event(type)): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  emitMessage(data: unknown): void {
    this.emit("message", { data } as MessageEvent);
  }

  send(value: string): void {
    this.sent.push(value);
  }

  close(): void {
    this.readyState = WebSocket.CLOSED;
    this.emit("close");
  }
}

type ClientCommandBody<T = ClientCommand> = T extends ClientCommand ? Omit<T, "timestamp" | "runId">
  : never;

function command(value: ClientCommandBody): ClientCommand {
  return { ...value, timestamp: Date.now(), runId: "run-1" } as ClientCommand;
}

async function settleCommands(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("AgentController", () => {
  it("correlates keyed input and admits legacy unkeyed input only when unambiguous", async () => {
    const publisher = new FakePublisher();
    const controller = new AgentController(publisher, { inputTimeout: 1_000 });
    const first = controller.requestInput("First?");
    const second = controller.requestInput("Second?");
    const inputRequests = publisher.events.filter((event) => event.type === "input_request");
    const firstRequestId = inputRequests[0]?.requestId;
    const secondRequestId = inputRequests[1]?.requestId;

    assertEquals(typeof firstRequestId, "string");
    assertEquals(typeof secondRequestId, "string");
    assertEquals(firstRequestId === secondRequestId, false);
    assertEquals(
      publisher.emit(command({ type: "input", content: "ambiguous", commandId: "command-1" })),
      [{ status: "rejected", reason: "input request is not pending or is ambiguous" }],
    );
    assertEquals(
      publisher.emit(command({
        type: "input",
        content: "first value",
        commandId: "command-2",
        requestId: firstRequestId,
      })),
      [{ status: "accepted" }],
    );
    assertEquals(await first, "first value");
    assertEquals(
      publisher.emit(command({ type: "input", content: "second value" })),
      [{ status: "accepted" }],
    );
    assertEquals(await second, "second value");
    controller.dispose();
  });

  it("does not bind a replayed command to a later request after publisher replacement", async () => {
    const firstPublisher = new FakePublisher();
    const secondPublisher = new FakePublisher();
    const controller = new AgentController(firstPublisher, { approvalTimeout: 1_000 });
    const first = controller.requestApproval("tool-1", "Write", {}, "first request");
    const replayed = command({
      type: "approve",
      toolCallId: "tool-1",
      commandId: "command-1",
    });

    firstPublisher.emit(replayed);
    assertEquals(await first, true);
    controller.attachPublisher(secondPublisher);

    let secondSettled = false;
    const second = controller.requestApproval("tool-1", "Write", {}, "later request");
    void second.then(() => {
      secondSettled = true;
    });
    secondPublisher.emit(replayed);
    await Promise.resolve();
    assertEquals(secondSettled, false);

    secondPublisher.emit(command({
      type: "approve",
      toolCallId: "tool-1",
      commandId: "command-2",
    }));
    assertEquals(await second, true);
    controller.dispose();
  });

  it("rejects duplicate pending approval IDs without orphaning the first request", async () => {
    const publisher = new FakePublisher();
    const controller = new AgentController(publisher, { approvalTimeout: 1_000 });

    const first = controller.requestApproval("tool-1", "Write", {}, "needs permission");
    await assertRejects(
      () => controller.requestApproval("tool-1", "Write", {}, "duplicate"),
      Error,
      "Approval is already pending",
    );

    publisher.emit(command({ type: "approve", toolCallId: "tool-1" }));
    assertEquals(await first, true);
    controller.dispose();
  });

  it("settles pending work and unsubscribes when disposed", async () => {
    const publisher = new FakePublisher();
    let cancelCalls = 0;
    const controller = new AgentController(publisher, {
      approvalTimeout: 1_000,
      inputTimeout: 1_000,
      onCancel: () => cancelCalls++,
    });
    const approval = controller.requestApproval("tool-1", "Write", {}, "needs permission");
    const input = controller.requestInput("Value?");

    assertEquals(publisher.subscriberCount, 1);
    controller.dispose();
    assertEquals(publisher.subscriberCount, 0);
    await assertRejects(() => approval, Error, "Agent controller disposed");
    await assertRejects(() => input, Error, "Agent controller disposed");

    publisher.emit(command({ type: "cancel", reason: "late" }));
    assertEquals(cancelCalls, 0);
    await assertRejects(
      () => controller.requestInput("late"),
      Error,
      "Agent controller disposed",
    );
  });

  it("validates request timers at construction", () => {
    for (const value of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      assertThrows(
        () => new AgentController(new FakePublisher(), { approvalTimeout: value }),
        Error,
        "approvalTimeout",
      );
      assertThrows(
        () => new AgentController(new FakePublisher(), { inputTimeout: value }),
        Error,
        "inputTimeout",
      );
    }
  });
});

describe("WebSocketPublisher", () => {
  it("rejects an oversized text frame before attempting UTF-8 encoding", () => {
    const socket = new FakeWebSocket();
    const publisher = new WebSocketPublisher({
      socket: socket as unknown as WebSocket,
      runId: "run-1",
      pingInterval: 0,
    });
    const OriginalTextEncoder = globalThis.TextEncoder;
    class BoundedTextEncoder extends OriginalTextEncoder {
      override encode(input?: string): Uint8Array {
        if ((input?.length ?? 0) > 64 * 1024) {
          throw new Error("oversized frame reached TextEncoder");
        }
        return super.encode(input);
      }
    }
    Object.defineProperty(globalThis, "TextEncoder", {
      configurable: true,
      value: BoundedTextEncoder,
      writable: true,
    });
    try {
      socket.emitMessage("x".repeat(64 * 1024 + 1));
      assertEquals(socket.sent, []);
    } finally {
      Object.defineProperty(globalThis, "TextEncoder", {
        configurable: true,
        value: OriginalTextEncoder,
        writable: true,
      });
      publisher.close();
    }
  });

  it("admits only bounded exact text commands for the connection run", async () => {
    const socket = new FakeWebSocket();
    const publisher = new WebSocketPublisher({
      socket: socket as unknown as WebSocket,
      runId: "run-1",
      pingInterval: 0,
    });
    const received: ClientCommand[] = [];
    publisher.onCommand((value) => {
      received.push(value);
    });

    socket.emitMessage(JSON.stringify({
      type: "cancel",
      timestamp: 1,
      runId: "run-1",
      reason: "stop",
    }));
    assertEquals(received.map((value) => value.type), ["cancel"]);
    socket.emitMessage(new Uint8Array([1, 2, 3]));
    socket.emitMessage(JSON.stringify({
      type: "cancel",
      timestamp: 2,
      runId: "run-2",
    }));
    socket.emitMessage(JSON.stringify({
      type: "cancel",
      timestamp: -1,
      runId: "run-1",
    }));
    socket.emitMessage(JSON.stringify({
      type: "cancel",
      timestamp: 3,
      runId: "run-1",
      unexpected: true,
    }));
    socket.emitMessage(JSON.stringify({
      type: "cancel",
      timestamp: 4,
      runId: "run-1",
      reason: "x".repeat(65 * 1024),
    }));
    await Promise.resolve();

    assertEquals(received.map((value) => value.type), ["cancel"]);
    publisher.close();
  });

  it("acknowledges an authoritative keyed command and replays without redispatch", async () => {
    const socket = new FakeWebSocket();
    const publisher = new WebSocketPublisher({
      socket: socket as unknown as WebSocket,
      runId: "run-1",
      pingInterval: 0,
    });
    let handled = 0;
    publisher.onCommand((value) => {
      handled += 1;
      assertEquals(value.type, "cancel");
      return { status: "accepted" };
    });
    const keyed = {
      type: "cancel",
      timestamp: 1,
      runId: "run-1",
      commandId: "command-1",
      reason: "stop",
    };

    socket.emitMessage(JSON.stringify(keyed));
    await settleCommands();
    socket.emitMessage(JSON.stringify({ ...keyed, timestamp: 2 }));
    await settleCommands();
    socket.emitMessage(JSON.stringify({ ...keyed, timestamp: 3, reason: "different" }));
    await settleCommands();

    assertEquals(handled, 1);
    assertEquals(
      socket.sent.map((value) => JSON.parse(value)),
      [
        {
          type: "command_ack",
          timestamp: JSON.parse(socket.sent[0]!).timestamp,
          runId: "run-1",
          commandId: "command-1",
          commandType: "cancel",
          status: "accepted",
        },
        {
          type: "command_ack",
          timestamp: JSON.parse(socket.sent[1]!).timestamp,
          runId: "run-1",
          commandId: "command-1",
          commandType: "cancel",
          status: "accepted",
        },
        {
          type: "command_ack",
          timestamp: JSON.parse(socket.sent[2]!).timestamp,
          runId: "run-1",
          commandId: "command-1",
          commandType: "cancel",
          status: "rejected",
          reason: "commandId was reused for another command",
        },
      ],
    );
    publisher.close();
  });

  it("treats legacy void handlers as non-authoritative for keyed commands", async () => {
    const socket = new FakeWebSocket();
    const publisher = new WebSocketPublisher({
      socket: socket as unknown as WebSocket,
      runId: "run-1",
      pingInterval: 0,
    });
    let handled = 0;
    publisher.onCommand(() => {
      handled += 1;
    });

    socket.emitMessage(JSON.stringify({
      type: "cancel",
      timestamp: 1,
      runId: "run-1",
      commandId: "observer-1",
    }));
    await settleCommands();

    assertEquals(handled, 1);
    const ack = JSON.parse(socket.sent[0]!);
    assertEquals(ack.status, "rejected");
    assertEquals(ack.reason, "no authoritative handler accepted");
    publisher.close();
  });

  it("allows only one authoritative command handler", () => {
    const socket = new FakeWebSocket();
    const publisher = new WebSocketPublisher({
      socket: socket as unknown as WebSocket,
      runId: "run-1",
      pingInterval: 0,
    });
    publisher.onCommand(() => ({ status: "accepted" }));

    assertThrows(
      () => publisher.onCommand(() => ({ status: "accepted" })),
      Error,
      "already has an authoritative handler",
    );
    publisher.close();
  });

  it("times out a hung authoritative handler so ledger capacity becomes available", async () => {
    const socket = new FakeWebSocket();
    const publisher = new WebSocketPublisher({
      socket: socket as unknown as WebSocket,
      runId: "run-1",
      pingInterval: 0,
      commandHandlerTimeout: 1,
    });
    let handled = 0;
    publisher.onCommand(() => {
      handled += 1;
      return new Promise(() => {});
    });

    for (let index = 0; index < 256; index++) {
      socket.emitMessage(JSON.stringify({
        type: "cancel",
        timestamp: index,
        runId: "run-1",
        commandId: `hung-${index}`,
      }));
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
    socket.emitMessage(JSON.stringify({
      type: "cancel",
      timestamp: 257,
      runId: "run-1",
      commandId: "after-timeout",
    }));

    assertEquals(handled, 257);
    const timeoutAck = socket.sent.map((value) => JSON.parse(value)).find((event) =>
      event.commandId === "hung-0"
    );
    assertEquals(timeoutAck?.status, "rejected");
    assertEquals(timeoutAck?.reason, "command handler timed out");
    publisher.close();
  });

  it("rejects a malformed keyed command without dispatching it", async () => {
    const socket = new FakeWebSocket();
    const publisher = new WebSocketPublisher({
      socket: socket as unknown as WebSocket,
      runId: "run-1",
      pingInterval: 0,
    });
    let handled = 0;
    publisher.onCommand(() => {
      handled += 1;
      return { status: "accepted" };
    });

    socket.emitMessage(JSON.stringify({
      type: "cancel",
      timestamp: 1,
      runId: "run-1",
      commandId: "invalid-1",
      unexpected: true,
    }));
    await settleCommands();

    assertEquals(handled, 0);
    const ack = JSON.parse(socket.sent[0]!);
    assertEquals({
      type: ack.type,
      runId: ack.runId,
      commandId: ack.commandId,
      commandType: ack.commandType,
      status: ack.status,
    }, {
      type: "command_ack",
      runId: "run-1",
      commandId: "invalid-1",
      commandType: "cancel",
      status: "rejected",
    });
    publisher.close();
  });

  it("contains an async handler rejection after the socket closes", async () => {
    const socket = new FakeWebSocket();
    const publisher = new WebSocketPublisher({
      socket: socket as unknown as WebSocket,
      runId: "run-1",
      pingInterval: 0,
    });
    let rejectHandler!: (reason: unknown) => void;
    publisher.onCommand(() =>
      new Promise((_resolve, reject) => {
        rejectHandler = reject;
      })
    );
    socket.emitMessage(JSON.stringify({
      type: "cancel",
      timestamp: 1,
      runId: "run-1",
      commandId: "async-1",
    }));
    await Promise.resolve();
    socket.close();
    socket.emitMessage(JSON.stringify({
      type: "cancel",
      timestamp: 2,
      runId: "run-1",
      commandId: "malformed-after-close",
      unexpected: true,
    }));
    rejectHandler(new Error("subscriber failed"));
    await settleCommands();

    assertEquals(publisher.isOpen, false);
  });

  it("acknowledges once an authoritative handler accepts without waiting for observers", async () => {
    const socket = new FakeWebSocket();
    const publisher = new WebSocketPublisher({
      socket: socket as unknown as WebSocket,
      runId: "run-1",
      pingInterval: 0,
    });
    publisher.onCommand(() => ({ status: "accepted" }));
    publisher.observeCommands(() => new Promise(() => {}));

    socket.emitMessage(JSON.stringify({
      type: "cancel",
      timestamp: 1,
      runId: "run-1",
      commandId: "authoritative-1",
    }));
    await settleCommands();

    const ack = JSON.parse(socket.sent[0]!);
    assertEquals(ack.status, "accepted");
    publisher.close();
  });

  it("coexists with other socket listeners and fails closed after close", () => {
    const socket = new FakeWebSocket();
    let externalCloseCalls = 0;
    socket.addEventListener("close", () => externalCloseCalls++);
    const publisher = new WebSocketPublisher({
      socket: socket as unknown as WebSocket,
      runId: "run-1",
      pingInterval: 0,
    });

    publisher.send({ type: "pong", timestamp: 1, runId: "run-1" });
    assertEquals(socket.sent.length, 1);
    socket.close();
    assertEquals(externalCloseCalls, 1);
    assertEquals(publisher.isOpen, false);
    assertThrows(
      () => publisher.send({ type: "pong", timestamp: 2, runId: "run-1" }),
      Error,
      "publisher is closed",
    );
  });

  it("validates connection identity and ping timer configuration", () => {
    const socket = new FakeWebSocket() as unknown as WebSocket;
    assertThrows(
      () => new WebSocketPublisher({ socket, runId: "", pingInterval: 0 }),
      Error,
      "runId must not be empty",
    );
    for (const pingInterval of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      assertThrows(
        () => new WebSocketPublisher({ socket, runId: "run-1", pingInterval }),
        Error,
        "pingInterval",
      );
    }
  });
});

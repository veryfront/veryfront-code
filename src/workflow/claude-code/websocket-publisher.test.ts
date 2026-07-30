import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type {
  BidirectionalPublisher,
  ClaudeCodeEvent,
  ClaudeCodeEventExtended,
  ClientCommand,
  ClientCommandHandler,
} from "./types.ts";
import { AgentController, WebSocketPublisher } from "./websocket-publisher.ts";

class FakePublisher implements BidirectionalPublisher {
  readonly events: ClaudeCodeEventExtended[] = [];
  private handlers = new Set<ClientCommandHandler>();

  get subscriberCount(): number {
    return this.handlers.size;
  }

  emit(command: ClientCommand): void {
    for (const handler of [...this.handlers]) handler(command);
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

describe("AgentController", () => {
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

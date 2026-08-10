import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertExists,
  assertRejects,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type {
  ApprovalRequestEvent,
  BidirectionalPublisher,
  ClaudeCodeEvent,
  ClaudeCodeEventExtended,
  ClientCommand,
  ClientCommandDisposition,
  ClientCommandHandler,
} from "./types.ts";
import {
  AgentController,
  type AgentControllerRegistration,
  AgentControllerRegistry,
  createWebSocketHandler,
  WebSocketPublisher,
} from "./index.ts";

class FakePublisher implements BidirectionalPublisher {
  constructor(readonly runId = "run-1") {}

  readonly events: ClaudeCodeEventExtended[] = [];
  private handlers = new Set<ClientCommandHandler>();
  private closed = false;

  get subscriberCount(): number {
    return this.handlers.size;
  }

  emit(
    command: ClientCommand,
  ): Array<ClientCommandDisposition | void | Promise<ClientCommandDisposition | void>> {
    if (this.closed) return [];
    return [...this.handlers].map((handler) => handler(command));
  }

  onCommand(handler: ClientCommandHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  send(event: ClaudeCodeEventExtended): void | Promise<void> {
    if (this.closed) throw new Error("publisher is closed");
    this.events.push(event);
  }

  publish(event: ClaudeCodeEvent): void {
    this.send(event);
  }

  close(): void {
    this.closed = true;
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

function registerController(
  publisher: BidirectionalPublisher,
  config: ConstructorParameters<typeof AgentControllerRegistry>[0] = {},
) {
  const registry = new AgentControllerRegistry(config);
  const registration = registry.register(publisher);
  return { controller: registration.controller, registration, registry };
}

describe("AgentController", () => {
  it("preserves direct construction for single-connection integrations", async () => {
    const publisher = new FakePublisher();
    const controller = new AgentController(publisher, { inputTimeout: 1_000 });
    const input = controller.requestInput("Value?");
    const request = publisher.events.find((event) => event.type === "input_request");

    publisher.emit(command({
      type: "input",
      content: "direct value",
      requestId: request?.requestId,
    }));

    assertEquals(await input, "direct value");
    controller.dispose();
    assertEquals(publisher.subscriberCount, 0);
  });

  it("installs input correlation before a reentrant client response", async () => {
    class ReentrantInputPublisher extends FakePublisher {
      override send(event: ClaudeCodeEventExtended): void {
        super.send(event);
        if (event.type !== "input_request") return;
        this.emit(command({
          type: "input",
          content: "immediate value",
          requestId: event.requestId,
        }));
      }
    }

    const publisher = new ReentrantInputPublisher();
    const { controller, registration, registry } = registerController(publisher, {
      inputTimeout: 1_000,
    });
    assertEquals(await controller.requestInput("Value?"), "immediate value");
    assertEquals(registry.releaseRun(registration.run), true);
  });

  it("rejects input requests when synchronous or asynchronous delivery fails", async () => {
    class FailingInputPublisher extends FakePublisher {
      constructor(private readonly asynchronous: boolean) {
        super();
      }

      override send(event: ClaudeCodeEventExtended): void | Promise<void> {
        if (event.type !== "input_request") return super.send(event);
        if (this.asynchronous) return Promise.reject(new Error("async send failed"));
        throw new Error("sync send failed");
      }
    }

    for (const asynchronous of [false, true]) {
      const publisher = new FailingInputPublisher(asynchronous);
      const { controller, registration, registry } = registerController(publisher, {
        inputTimeout: 1_000,
      });
      await assertRejects(
        () => controller.requestInput("Value?"),
        Error,
        "Input request delivery failed",
      );
      assertEquals(
        publisher.emit(command({ type: "input", content: "late value" })),
        [{ status: "rejected", reason: "input request is not pending or is ambiguous" }],
      );
      assertEquals(registry.releaseRun(registration.run), true);
    }
  });

  it("rejects unbounded input fields before publishing or retaining work", async () => {
    const publisher = new FakePublisher();
    const { controller, registration, registry } = registerController(publisher, {
      inputTimeout: 1_000,
    });
    const oversized = "x".repeat(32 * 1024 + 1);

    await assertRejects(
      () => controller.requestInput(oversized),
      Error,
      "Input text exceeds the wire field limit",
    );
    await assertRejects(
      () => controller.requestInput("Value?", oversized),
      Error,
      "Input text exceeds the wire field limit",
    );
    assertEquals(publisher.events, []);
    assertEquals(registry.releaseRun(registration.run), true);
  });

  it("fails closed when the input request identity space is exhausted", async () => {
    const publisher = new FakePublisher();
    const { controller, registration, registry } = registerController(publisher);
    const originalIsSafeInteger = Number.isSafeInteger;
    Number.isSafeInteger = (value: unknown): value is number =>
      value === 1 ? false : originalIsSafeInteger(value);
    try {
      await assertRejects(
        () => controller.requestInput("Value?"),
        Error,
        "input request identity space is exhausted",
      );
    } finally {
      Number.isSafeInteger = originalIsSafeInteger;
    }
    assertEquals(publisher.events, []);
    assertEquals(registry.releaseRun(registration.run), true);
  });

  it("publishes an approval only after its exact correlation is pending", async () => {
    class ReentrantPublisher extends FakePublisher {
      override send(event: ClaudeCodeEventExtended): void {
        super.send(event);
        if (event.type !== "approval_request") return;
        this.emit(command({
          type: "approve",
          toolCallId: event.toolCallId,
          requestId: event.requestId,
          commandId: "reentrant-approval",
        }));
      }
    }

    const publisher = new ReentrantPublisher();
    const { controller, registration, registry } = registerController(publisher, {
      approvalTimeout: 1,
    });
    assertEquals(
      await controller.requestApproval("tool-reentrant", "Write", {}, "needs permission"),
      true,
    );
    registry.releaseRun(registration.run);
  });

  it("binds every approval decision to immutable run and unique request identities", async () => {
    const publisher = new FakePublisher("run-1");
    const { controller, registration, registry } = registerController(publisher, {
      approvalTimeout: 1_000,
    });
    assertEquals(Reflect.set(controller, "runId", "run-2"), false);
    assertEquals(Reflect.defineProperty(controller, "runId", { value: "run-2" }), false);
    Reflect.set(controller, "controllerRunId", "run-2");
    assertEquals(controller.runId, "run-1");
    const first = controller.requestApproval("tool-1", "Write", {}, "first request");
    const second = controller.requestApproval("tool-2", "Write", {}, "second request");
    const requests = publisher.events.filter((event) => event.type === "approval_request") as Array<
      ClaudeCodeEventExtended & { runId: string; requestId: string }
    >;
    const firstRequest = requests[0];
    const secondRequest = requests[1];

    assertEquals(firstRequest?.runId, "run-1");
    assertEquals(typeof firstRequest?.requestId, "string");
    assertEquals(secondRequest?.runId, "run-1");
    assertEquals(typeof secondRequest?.requestId, "string");
    assertEquals(firstRequest?.requestId === secondRequest?.requestId, false);

    const missingCorrelation = {
      type: "approve",
      timestamp: Date.now(),
      runId: "run-1",
      commandId: "missing-request",
      toolCallId: "tool-1",
    } as ClientCommand;
    assertEquals(
      publisher.emit(missingCorrelation),
      [{ status: "rejected", reason: "approval correlation does not match a pending request" }],
    );

    const wrongRequest = {
      ...missingCorrelation,
      commandId: "wrong-request",
      requestId: secondRequest?.requestId,
    } as ClientCommand;
    assertEquals(
      publisher.emit(wrongRequest),
      [{ status: "rejected", reason: "approval correlation does not match a pending request" }],
    );

    const wrongRun = {
      ...missingCorrelation,
      commandId: "wrong-run",
      requestId: firstRequest?.requestId,
      runId: "run-2",
    } as ClientCommand;
    assertEquals(
      publisher.emit(wrongRun),
      [{ status: "rejected", reason: "command runId does not match the agent controller" }],
    );

    assertEquals(
      publisher.emit({
        ...missingCorrelation,
        commandId: "approve-first",
        requestId: firstRequest?.requestId,
      } as ClientCommand),
      [{ status: "accepted" }],
    );
    assertEquals(await first, true);
    registry.releaseRun(registration.run);
    await assertRejects(() => second, Error, "Agent controller disposed");
  });

  it("correlates keyed input and admits legacy unkeyed input only when unambiguous", async () => {
    const publisher = new FakePublisher();
    const { controller, registration, registry } = registerController(publisher, {
      inputTimeout: 1_000,
    });
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
    registry.releaseRun(registration.run);
  });

  it("fences delayed input commands after a same-run controller is recreated", async () => {
    const registry = new AgentControllerRegistry({ inputTimeout: 1_000 });
    const firstPublisher = new FakePublisher("run-1");
    const firstRegistration = registry.register(firstPublisher);
    const firstInput = firstRegistration.controller.requestInput("First value?");
    const firstRequest = firstPublisher.events.find((event) => event.type === "input_request");
    assertExists(firstRequest);

    assertEquals(registry.releaseRun(firstRegistration.run), true);
    await assertRejects(() => firstInput, Error, "Agent controller disposed");

    const secondPublisher = new FakePublisher("run-1");
    const secondRegistration = registry.register(secondPublisher);
    const secondInput = secondRegistration.controller.requestInput("Second value?");
    const secondRequest = secondPublisher.events.find((event) => event.type === "input_request");
    assertExists(secondRequest);
    assertEquals(firstRequest.requestId === secondRequest.requestId, false);

    assertEquals(
      secondPublisher.emit(command({
        type: "input",
        content: "stale value",
        commandId: "delayed-first-input",
        requestId: firstRequest.requestId,
      })),
      [{ status: "rejected", reason: "input request is not pending or is ambiguous" }],
    );
    secondPublisher.emit(command({
      type: "input",
      content: "current value",
      commandId: "current-input",
      requestId: secondRequest.requestId,
    }));
    assertEquals(await secondInput, "current value");
    assertEquals(registry.releaseRun(secondRegistration.run), true);
  });

  it("does not bind a replayed command to a later request after publisher replacement", async () => {
    const firstPublisher = new FakePublisher();
    const secondPublisher = new FakePublisher();
    const { controller, registry } = registerController(firstPublisher, {
      approvalTimeout: 1_000,
    });
    const first = controller.requestApproval("tool-1", "Write", {}, "first request");
    const firstRequest = firstPublisher.events.find((event) => event.type === "approval_request");
    const replayed = command({
      type: "approve",
      toolCallId: "tool-1",
      commandId: "command-1",
      requestId: firstRequest?.requestId ?? "missing",
    });

    firstPublisher.emit(replayed);
    assertEquals(await first, true);
    const replacementRegistration = registry.register(secondPublisher);

    let secondSettled = false;
    const second = controller.requestApproval("tool-1", "Write", {}, "later request");
    const secondRequest = secondPublisher.events.find((event) => event.type === "approval_request");
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
      requestId: secondRequest?.requestId ?? "missing",
    }));
    assertEquals(await second, true);
    registry.releaseRun(replacementRegistration.run);
  });

  it("rejects duplicate pending approval IDs without orphaning the first request", async () => {
    const publisher = new FakePublisher();
    const { controller, registration, registry } = registerController(publisher, {
      approvalTimeout: 1_000,
    });

    const first = controller.requestApproval("tool-1", "Write", {}, "needs permission");
    const request = publisher.events.find((event) => event.type === "approval_request");
    await assertRejects(
      () => controller.requestApproval("tool-1", "Write", {}, "duplicate"),
      Error,
      "Approval is already pending",
    );

    publisher.emit(command({
      type: "approve",
      toolCallId: "tool-1",
      commandId: "approve-tool-1",
      requestId: request?.requestId ?? "missing",
    }));
    assertEquals(await first, true);
    registry.releaseRun(registration.run);
  });

  it("settles pending work and unsubscribes when disposed", async () => {
    const publisher = new FakePublisher();
    let cancelCalls = 0;
    const { controller, registration, registry } = registerController(publisher, {
      approvalTimeout: 1_000,
      inputTimeout: 1_000,
      onCancel: () => cancelCalls++,
    });
    const approval = controller.requestApproval("tool-1", "Write", {}, "needs permission");
    const input = controller.requestInput("Value?");

    assertEquals(publisher.subscriberCount, 1);
    registry.releaseRun(registration.run);
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

  it("settles pending work even when publisher unsubscription fails", async () => {
    class FailingUnsubscribePublisher extends FakePublisher {
      override onCommand(handler: ClientCommandHandler): () => void {
        const unsubscribe = super.onCommand(handler);
        return () => {
          unsubscribe();
          throw new Error("unsubscribe failed");
        };
      }
    }

    const publisher = new FailingUnsubscribePublisher();
    const { controller, registration, registry } = registerController(publisher, {
      approvalTimeout: 1_000,
      inputTimeout: 1_000,
    });
    const approval = controller.requestApproval("tool-1", "Write", {}, "needs permission");
    const input = controller.requestInput("Value?");

    assertThrows(() => registry.releaseRun(registration.run), Error, "unsubscribe failed");
    assertEquals(publisher.subscriberCount, 0);
    await assertRejects(() => approval, Error, "Agent controller disposed");
    await assertRejects(() => input, Error, "Agent controller disposed");
  });

  it("validates request timers at construction", () => {
    for (const value of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      assertThrows(
        () => new AgentControllerRegistry({ approvalTimeout: value }).register(new FakePublisher()),
        Error,
        "approvalTimeout",
      );
      assertThrows(
        () => new AgentControllerRegistry({ inputTimeout: value }).register(new FakePublisher()),
        Error,
        "inputTimeout",
      );
    }
  });
});

describe("AgentControllerRegistry", () => {
  it("rejects approval identities and payloads that cannot round-trip on the wire", async () => {
    const registry = new AgentControllerRegistry({ approvalTimeout: 1 });
    const publisher = new FakePublisher();
    const registration = registry.register(publisher);

    await assertRejects(
      () =>
        registration.controller.requestApproval(
          "x".repeat(257),
          "Write",
          {},
          "needs permission",
        ),
      Error,
      "toolCallId",
    );
    await assertRejects(
      () =>
        registration.controller.requestApproval(
          "tool-large",
          "Write",
          { content: "x".repeat(64 * 1024) },
          "needs permission",
        ),
      Error,
      "wire JSON",
    );
    assertEquals(publisher.events, []);
    assertEquals(registry.releaseRun(registration.run), true);
  });

  it("replays immutable pending approvals and fences retired delivery failures", async () => {
    class DeferredPublisher extends FakePublisher {
      rejectDelivery: ((reason: unknown) => void) | undefined;

      override send(event: ClaudeCodeEventExtended): Promise<void> {
        super.send(event);
        return new Promise((_resolve, reject) => {
          this.rejectDelivery = reject;
        });
      }
    }

    const registry = new AgentControllerRegistry({ approvalTimeout: 1_000 });
    const firstPublisher = new DeferredPublisher("run-1");
    const firstRegistration = registry.register(firstPublisher);
    const sourceInput = { path: "README.md", nested: { safe: true } };
    const approval = firstRegistration.controller.requestApproval(
      "tool-1",
      "Write",
      sourceInput,
      "needs permission",
    );
    const request = firstPublisher.events.find((event) => event.type === "approval_request");
    assertExists(request);
    sourceInput.path = "mutated-after-request";
    sourceInput.nested.safe = false;
    assertEquals(Object.isFrozen(request), true);
    assertEquals(Object.isFrozen(request.input), true);
    assertEquals(Object.isFrozen(request.input.nested), true);
    assertEquals(request.input, { path: "README.md", nested: { safe: true } });

    assertEquals(registry.detach(firstRegistration), true);
    const gapApproval = firstRegistration.controller.requestApproval(
      "tool-gap",
      "Write",
      { path: "gap.txt" },
      "requested while detached",
    );
    assertEquals(firstPublisher.events, [request]);
    const replacementPublisher = new FakePublisher("run-1");
    const replacementRegistration = registry.register(replacementPublisher);
    const gapRequest = replacementPublisher.events.find(
      (event): event is ApprovalRequestEvent =>
        event.type === "approval_request" && event.toolCallId === "tool-gap",
    );
    assertExists(gapRequest);
    assertEquals(replacementPublisher.events, [request, gapRequest]);

    firstPublisher.rejectDelivery?.(new Error("retired delivery failed"));
    await settleCommands();
    replacementPublisher.emit(command({
      type: "approve",
      commandId: "approve-replayed",
      requestId: request.requestId,
      toolCallId: request.toolCallId,
    }));
    assertEquals(await approval, true);
    replacementPublisher.emit(command({
      type: "approve",
      commandId: "approve-gap",
      requestId: gapRequest.requestId,
      toolCallId: gapRequest.toolCallId,
    }));
    assertEquals(await gapApproval, true);
    assertEquals(registry.releaseRun(replacementRegistration.run), true);
  });

  it("replays an immutable pending input after transport replacement", async () => {
    const registry = new AgentControllerRegistry({ inputTimeout: 1_000 });
    const firstPublisher = new FakePublisher("run-1");
    const firstRegistration = registry.register(firstPublisher);
    const input = firstRegistration.controller.requestInput("Value?", "default");
    const request = firstPublisher.events.find((event) => event.type === "input_request");
    assertExists(request);
    assertEquals(Object.isFrozen(request), true);

    assertEquals(registry.detach(firstRegistration), true);
    const replacementPublisher = new FakePublisher("run-1");
    const replacementRegistration = registry.register(replacementPublisher);
    assertEquals(replacementPublisher.events, [request]);

    replacementPublisher.emit(command({
      type: "input",
      content: "replacement value",
      requestId: request.requestId,
    }));
    assertEquals(await input, "replacement value");
    assertEquals(registry.releaseRun(replacementRegistration.run), true);
  });

  it("exposes no controller lifecycle authority through registrations", () => {
    const registry = new AgentControllerRegistry();
    const registration = registry.register(new FakePublisher());

    assertEquals("attachPublisher" in registration.controller, false);
    assertEquals("dispose" in registration.controller, false);
    assertEquals(registry.releaseRun(registration.run), true);
  });

  it("retains run state across a disconnected gap and fences exact publisher generations", async () => {
    const registry = new AgentControllerRegistry({ approvalTimeout: 1_000 });
    const firstPublisher = new FakePublisher("run-1");
    const firstRegistration = registry.register(firstPublisher);
    const approval = firstRegistration.controller.requestApproval(
      "tool-1",
      "Write",
      {},
      "needs permission",
    );
    const request = firstPublisher.events.find((event) => event.type === "approval_request");
    assertEquals(registry.detach(firstRegistration), true);
    assertEquals(registry.get("run-1"), firstRegistration.run);

    const replacementPublisher = new FakePublisher("run-1");
    const replacementRegistration = registry.register(replacementPublisher);

    assertEquals(replacementRegistration.controller, firstRegistration.controller);
    assertEquals(replacementRegistration.run, firstRegistration.run);
    assertEquals(replacementRegistration.generation === firstRegistration.generation, false);
    assertEquals(registry.detach(firstRegistration), false);
    assertEquals(registry.getPublisher("run-1"), replacementRegistration);
    assertThrows(
      () => firstPublisher.send({ type: "pong", timestamp: 1, runId: "run-1" }),
      Error,
      "publisher is closed",
    );
    assertEquals(
      firstPublisher.emit(command({
        type: "approve",
        toolCallId: "tool-1",
        requestId: request?.requestId ?? "missing",
        commandId: "stale-command",
      })),
      [],
    );

    assertEquals(
      replacementPublisher.emit(command({
        type: "approve",
        toolCallId: "tool-1",
        requestId: request?.requestId ?? "missing",
        commandId: "current-command",
      })),
      [{ status: "accepted" }],
    );
    assertEquals(await approval, true);
    assertEquals(registry.releaseRun(replacementRegistration.run), true);
    assertEquals(registry.get("run-1"), undefined);

    const nextRegistration = registry.register(new FakePublisher("run-1"));
    assertEquals(nextRegistration.run === replacementRegistration.run, false);
    assertEquals(registry.releaseRun(replacementRegistration.run), false);
    assertEquals(registry.get("run-1"), nextRegistration.run);
    assertEquals(registry.releaseRun(nextRegistration.run), true);
  });

  it("rejects a delayed command callback from a retired publisher generation", async () => {
    class DelayedCommandPublisher extends FakePublisher {
      capturedHandler: ClientCommandHandler | undefined;

      override onCommand(handler: ClientCommandHandler): () => void {
        this.capturedHandler = handler;
        return super.onCommand(handler);
      }
    }

    const registry = new AgentControllerRegistry({ approvalTimeout: 1_000 });
    const retiredPublisher = new DelayedCommandPublisher("run-1");
    const first = registry.register(retiredPublisher);
    const approval = first.controller.requestApproval(
      "tool-1",
      "Write",
      {},
      "needs permission",
    );
    const request = retiredPublisher.events.find((event) => event.type === "approval_request");
    assertExists(request);
    const delayedHandler = retiredPublisher.capturedHandler;
    assertExists(delayedHandler);

    const currentPublisher = new FakePublisher("run-1");
    const current = registry.register(currentPublisher);
    let settled = false;
    void approval.then(() => {
      settled = true;
    });

    const staleDisposition = await Promise.resolve(
      delayedHandler(command({
        type: "approve",
        commandId: "retired-approval",
        requestId: request.requestId,
        toolCallId: request.toolCallId,
      })),
    );
    await Promise.resolve();

    assertEquals(staleDisposition?.status, "rejected");
    assertEquals(settled, false);
    assertEquals(
      currentPublisher.emit(command({
        type: "approve",
        commandId: "current-approval",
        requestId: request.requestId,
        toolCallId: request.toolCallId,
      })),
      [{ status: "accepted" }],
    );
    assertEquals(await approval, true);
    assertEquals(registry.releaseRun(current.run), true);
  });
});

describe("createWebSocketHandler", () => {
  it("rejects invalid run identities before WebSocket upgrade", () => {
    let runId = "";
    let upgrades = 0;
    const registry = new AgentControllerRegistry();
    const handler = createWebSocketHandler({
      getRunId: () => runId,
      registry,
      onConnection: () => {},
      upgradeWebSocket: () => {
        upgrades += 1;
        return {
          socket: new FakeWebSocket() as unknown as WebSocket,
          response: new Response(),
        };
      },
    });

    try {
      for (const invalid of ["", " run-1", "run\u0000", "x".repeat(257)]) {
        runId = invalid;
        assertEquals(handler(new Request("https://example.test/ws")).status, 400);
      }
      assertEquals(upgrades, 0);
    } finally {
      registry.close();
    }
  });

  it("closes the exact upgraded socket when publisher setup throws", () => {
    class SetupFailingWebSocket extends FakeWebSocket {
      override addEventListener(type: string, listener: (event: Event) => void): void {
        if (type === "message") throw new Error("publisher setup failed");
        super.addEventListener(type, listener);
      }
    }

    const socket = new SetupFailingWebSocket();
    let connections = 0;
    const registry = new AgentControllerRegistry();
    const handler = createWebSocketHandler({
      getRunId: () => "run-1",
      registry,
      onConnection: () => {
        connections += 1;
      },
      upgradeWebSocket: () => ({
        socket: socket as unknown as WebSocket,
        response: new Response(),
      }),
    });

    try {
      assertEquals(handler(new Request("https://example.test/ws")).status, 200);
      socket.emit("open");
      assertEquals(socket.readyState, WebSocket.CLOSED);
      assertEquals(connections, 0);
      assertEquals(registry.get("run-1"), undefined);
    } finally {
      registry.close();
    }
  });

  it("retains pending approvals across a non-overlapping socket reconnect", async () => {
    const firstSocket = new FakeWebSocket();
    const replacementSocket = new FakeWebSocket();
    const sockets = [firstSocket, replacementSocket];
    const connected: AgentControllerRegistration[] = [];
    const closed: symbol[] = [];
    const upgradeWebSocket = () => ({
      socket: sockets.shift() as unknown as WebSocket,
      response: new Response(),
    });

    const registry = new AgentControllerRegistry({ approvalTimeout: 1_000 });
    try {
      const handler = createWebSocketHandler({
        getRunId: () => "run-1",
        registry,
        upgradeWebSocket,
        onConnection: (registration) => {
          connected.push(registration);
        },
        onClose: (registration) => {
          closed.push(registration.generation);
        },
      });

      handler(new Request("https://example.test/ws"));
      firstSocket.emit("open");
      await settleCommands();
      const first = connected[0];
      assertExists(first);
      const approval = first.controller.requestApproval(
        "tool-1",
        "Write",
        {},
        "needs permission",
      );
      const request = firstSocket.sent.map((value) => JSON.parse(value)).find((event) =>
        event.type === "approval_request"
      ) as { requestId: string; toolCallId: string } | undefined;
      assertExists(request);

      firstSocket.close();
      await settleCommands();
      assertEquals(closed, [first.generation]);
      assertEquals(registry.get("run-1"), first.run);
      assertEquals(registry.getPublisher("run-1"), undefined);

      handler(new Request("https://example.test/ws"));
      replacementSocket.emit("open");
      await settleCommands();
      const replacement = connected[1];
      assertExists(replacement);
      assertEquals(replacement.controller, first.controller);
      assertEquals(replacement.run, first.run);

      replacementSocket.emitMessage(JSON.stringify({
        type: "approve",
        timestamp: Date.now(),
        runId: "run-1",
        commandId: "approve-after-reconnect",
        requestId: request?.requestId,
        toolCallId: request?.toolCallId,
      }));
      assertEquals(await approval, true);
      await settleCommands();
      const acknowledgement = replacementSocket.sent.map((value) => JSON.parse(value)).find(
        (event) => event.type === "command_ack",
      );
      assertEquals(acknowledgement?.requestId, request?.requestId);
      assertEquals(acknowledgement?.status, "accepted");

      replacementSocket.close();
      await settleCommands();
      assertEquals(closed, [first.generation, replacement.generation]);
      assertEquals(registry.get("run-1"), replacement.run);
      assertEquals(registry.releaseRun(replacement.run), true);
    } finally {
      registry.close();
    }
  });

  it("does not report a retired connection close as the current run closing", async () => {
    const firstSocket = new FakeWebSocket();
    const replacementSocket = new FakeWebSocket();
    const sockets = [firstSocket, replacementSocket];
    const connected: AgentControllerRegistration[] = [];
    const closed: symbol[] = [];
    const upgradeWebSocket = () => ({
      socket: sockets.shift() as unknown as WebSocket,
      response: new Response(),
    });

    const registry = new AgentControllerRegistry();
    try {
      const handler = createWebSocketHandler({
        getRunId: () => "run-1",
        registry,
        upgradeWebSocket,
        onConnection: (registration) => {
          connected.push(registration);
        },
        onClose: (registration) => {
          closed.push(registration.generation);
        },
      });

      handler(new Request("https://example.test/ws"));
      firstSocket.emit("open");
      await settleCommands();
      handler(new Request("https://example.test/ws"));
      replacementSocket.emit("open");
      await settleCommands();

      assertEquals(connected.length, 2);
      assertEquals(connected[0]?.controller, connected[1]?.controller);
      assertEquals(closed, []);
      firstSocket.emit("close");
      await settleCommands();
      assertEquals(closed, []);

      replacementSocket.close();
      await settleCommands();
      assertEquals(closed, [connected[1]?.generation]);
    } finally {
      registry.close();
    }
  });
});

describe("WebSocketPublisher", () => {
  it("rejects malformed, inherited, and thenable command dispositions", async () => {
    const cases: Array<{
      create: () => ClientCommandDisposition;
      verify?: () => void;
    }> = [];
    cases.push({
      create: () => Object.create({ status: "accepted" }) as ClientCommandDisposition,
    });
    cases.push({
      create: () => ({ status: "accepted", unexpected: true }) as ClientCommandDisposition,
    });
    let getterCalls = 0;
    cases.push({
      create: () => {
        const disposition = {};
        Object.defineProperty(disposition, "status", {
          enumerable: true,
          get: () => {
            getterCalls += 1;
            return "accepted";
          },
        });
        return disposition as ClientCommandDisposition;
      },
      verify: () => assertEquals(getterCalls, 0),
    });
    let thenCalls = 0;
    cases.push({
      create: () =>
        ({
          then: () => {
            thenCalls += 1;
          },
        }) as unknown as ClientCommandDisposition,
      verify: () => assertEquals(thenCalls, 0),
    });

    for (const [index, disposition] of cases.entries()) {
      const socket = new FakeWebSocket();
      const publisher = new WebSocketPublisher({
        socket: socket as unknown as WebSocket,
        runId: "run-1",
        pingInterval: 0,
        commandHandlerTimeout: 1_000,
      });
      publisher.onCommand(() => disposition.create());
      socket.emitMessage(JSON.stringify({
        type: "cancel",
        timestamp: index,
        runId: "run-1",
        commandId: `malformed-disposition-${index}`,
      }));
      await settleCommands();

      disposition.verify?.();
      const acknowledgement = JSON.parse(socket.sent[0]!);
      assertEquals(acknowledgement.status, "rejected");
      assertEquals(acknowledgement.reason, "command handler returned an invalid disposition");
      publisher.close();
    }

    const socket = new FakeWebSocket();
    const publisher = new WebSocketPublisher({
      socket: socket as unknown as WebSocket,
      runId: "run-1",
      pingInterval: 0,
    });
    publisher.onCommand(async () => ({ status: "accepted" }));
    socket.emitMessage(JSON.stringify({
      type: "cancel",
      timestamp: 5,
      runId: "run-1",
      commandId: "native-promise-disposition",
    }));
    await settleCommands();
    assertEquals(JSON.parse(socket.sent[0]!).status, "accepted");
    publisher.close();
  });

  it("rejects a proxied native Promise disposition without escaping dispatch", async () => {
    const socket = new FakeWebSocket();
    const publisher = new WebSocketPublisher({
      socket: socket as unknown as WebSocket,
      runId: "run-1",
      pingInterval: 0,
    });
    const proxiedPromise = new Proxy(
      Promise.resolve<ClientCommandDisposition>({ status: "accepted" }),
      {},
    );
    publisher.onCommand(() => proxiedPromise);

    let thrown: unknown;
    try {
      socket.emitMessage(JSON.stringify({
        type: "cancel",
        timestamp: 1,
        runId: "run-1",
        commandId: "proxied-promise-disposition",
      }));
    } catch (error) {
      thrown = error;
    }
    await settleCommands();

    assertEquals(thrown, undefined);
    const acknowledgement = JSON.parse(socket.sent[0]!);
    assertEquals(acknowledgement.status, "rejected");
    assertEquals(acknowledgement.reason, "command handler returned an invalid disposition");
    publisher.close();
  });

  it("keeps runtime run identity authoritative and bounds outgoing wire payloads", () => {
    const socket = new FakeWebSocket();
    const publisher = new WebSocketPublisher({
      socket: socket as unknown as WebSocket,
      runId: "run-1",
      pingInterval: 0,
    });
    assertEquals(Reflect.defineProperty(publisher, "runId", { value: "run-2" }), false);
    Reflect.set(publisher, "connectionRunId", "run-2");
    publisher.send({ type: "pong", timestamp: 1, runId: "run-1" });
    assertEquals(JSON.parse(socket.sent[0]!).runId, "run-1");

    const OriginalTextEncoder = globalThis.TextEncoder;
    class BoundedTextEncoder extends OriginalTextEncoder {
      override encode(input?: string) {
        if ((input?.length ?? 0) > 64 * 1024) {
          throw new Error("oversized payload reached TextEncoder");
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
      assertThrows(
        () =>
          publisher.send({
            type: "text_delta",
            timestamp: 2,
            content: "x".repeat(64 * 1024),
          }),
        Error,
        "wire byte limit",
      );
    } finally {
      Object.defineProperty(globalThis, "TextEncoder", {
        configurable: true,
        value: OriginalTextEncoder,
        writable: true,
      });
      publisher.close();
    }
  });

  it("rejects outgoing events that violate the shared field contract before send", () => {
    const socket = new FakeWebSocket();
    const publisher = new WebSocketPublisher({
      socket: socket as unknown as WebSocket,
      runId: "run-1",
      pingInterval: 0,
    });

    assertThrows(
      () =>
        publisher.send({
          type: "tool_call_start",
          timestamp: 1,
          toolCallId: "x".repeat(257),
          toolName: "Write",
        }),
      Error,
      "tool_call_start",
    );
    assertThrows(
      () =>
        publisher.send({
          type: "text_delta",
          timestamp: 2,
          content: "x".repeat(32 * 1024 + 1),
        }),
      Error,
      "text_delta",
    );
    assertEquals(socket.sent, []);
    publisher.close();
  });

  it("rejects an oversized text frame before attempting UTF-8 encoding", () => {
    const socket = new FakeWebSocket();
    const publisher = new WebSocketPublisher({
      socket: socket as unknown as WebSocket,
      runId: "run-1",
      pingInterval: 0,
    });
    const OriginalTextEncoder = globalThis.TextEncoder;
    class BoundedTextEncoder extends OriginalTextEncoder {
      override encode(input?: string) {
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

  it("isolates the authoritative command from passive observer mutation", async () => {
    const socket = new FakeWebSocket();
    const publisher = new WebSocketPublisher({
      socket: socket as unknown as WebSocket,
      runId: "run-1",
      pingInterval: 0,
    });
    let authoritativeReason: string | undefined;
    publisher.onCommand((received) => {
      if (received.type === "cancel") authoritativeReason = received.reason;
      return { status: "accepted" };
    });
    publisher.observeCommands((received) => {
      if (received.type === "cancel") received.reason = "mutated";
    });

    socket.emitMessage(JSON.stringify({
      type: "cancel",
      timestamp: 1,
      runId: "run-1",
      commandId: "isolated-1",
      reason: "original",
    }));
    await settleCommands();

    assertEquals(authoritativeReason, "original");
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
    assertThrows(
      () => publisher.onCommand(() => ({ status: "accepted" })),
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

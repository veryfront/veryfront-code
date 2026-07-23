import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createEscapeBuffer,
  createNodeStdinReader,
  createWebStdinReader,
  getNodeStdinFromHost,
  type NodeStdinEvent,
  type NodeStdinListener,
  type NodeStdinStream,
  setNodeStdinRawMode,
  setRawMode,
  waitForEnterOrExit,
  waitForKeypress,
  waitForNodeEnterOrExit,
  waitForNodeKeypress,
} from "./stdin.ts";

class TestNodeStdin implements NodeStdinStream {
  private readonly listeners = new Map<string, Set<NodeStdinListener>>();
  readonly rawModes: boolean[] = [];
  resumeCount = 0;
  pauseCount = 0;
  isRaw: boolean;
  readonly readableEnded: boolean;
  readonly destroyed: boolean;
  readonly errored: unknown;
  readonly readableAborted: boolean;
  readableFlowing: boolean | null;

  constructor(
    options: {
      isRaw?: boolean;
      paused?: boolean;
      setRawMode?: (enabled: boolean) => void;
      resume?: () => void;
      pause?: () => void;
      on?: (event: string) => void;
      readableEnded?: boolean;
      destroyed?: boolean;
      errored?: unknown;
      readableAborted?: boolean;
      readableFlowing?: boolean | null;
    } = {},
  ) {
    this.isRaw = options.isRaw ?? false;
    this.readableFlowing = "readableFlowing" in options
      ? options.readableFlowing ?? null
      : options.paused === undefined
      ? null
      : !options.paused;
    this.setRawModeImplementation = options.setRawMode ?? (() => {});
    this.resumeImplementation = options.resume ?? (() => {});
    this.pauseImplementation = options.pause ?? (() => {});
    this.onImplementation = options.on ?? (() => {});
    this.readableEnded = options.readableEnded ?? false;
    this.destroyed = options.destroyed ?? false;
    this.errored = options.errored;
    this.readableAborted = options.readableAborted ?? false;
  }

  private readonly setRawModeImplementation: (enabled: boolean) => void;
  private readonly resumeImplementation: () => void;
  private readonly pauseImplementation: () => void;
  private readonly onImplementation: (event: string) => void;

  setRawMode(enabled: boolean): void {
    this.rawModes.push(enabled);
    this.setRawModeImplementation(enabled);
    this.isRaw = enabled;
  }

  resume(): void {
    this.resumeCount += 1;
    this.resumeImplementation();
    this.readableFlowing = true;
  }

  pause(): void {
    this.pauseCount += 1;
    this.pauseImplementation();
    this.readableFlowing = false;
  }

  isPaused(): boolean {
    return this.readableFlowing === false;
  }

  on(event: NodeStdinEvent, listener: NodeStdinListener): void {
    this.onImplementation(event);
    let listeners = this.listeners.get(event);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(event, listeners);
    }
    listeners.add(listener);
    if (event === "data") this.readableFlowing = true;
  }

  off(event: NodeStdinEvent, listener: NodeStdinListener): void {
    this.listeners.get(event)?.delete(listener);
  }

  emitData(data: Uint8Array): void {
    for (const listener of this.listeners.get("data") ?? []) {
      listener(data);
    }
  }

  emitFlowingData(data: Uint8Array): void {
    if (this.readableFlowing === true) this.emitData(data);
  }

  emitEnd(event: "end" | "close" = "end"): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener();
    }
  }

  emitError(error: unknown): void {
    for (const listener of this.listeners.get("error") ?? []) {
      listener(error);
    }
  }

  listenerCount(event: string): number {
    return this.listeners.get(event)?.size ?? 0;
  }
}

class TestStreamReader {
  releaseCount = 0;

  constructor(
    private readonly readImplementation: () => Promise<{
      value: Uint8Array | undefined;
      done: boolean;
    }>,
    private readonly releaseImplementation: () => void = () => {},
  ) {}

  read(): Promise<{ value: Uint8Array | undefined; done: boolean }> {
    return this.readImplementation();
  }

  releaseLock(): void {
    this.releaseCount += 1;
    this.releaseImplementation();
  }
}

class TestDenoStdin {
  readonly rawModes: boolean[] = [];
  readonly readable: { getReader: () => TestStreamReader };

  constructor(
    reader: TestStreamReader | (() => TestStreamReader),
    private readonly setRawImplementation: (enabled: boolean) => void = () => {},
  ) {
    this.readable = {
      getReader: typeof reader === "function" ? reader : () => reader,
    };
  }

  setRaw(enabled: boolean): void {
    this.rawModes.push(enabled);
    this.setRawImplementation(enabled);
  }
}

async function withTestDenoStdin<T>(stdin: TestDenoStdin, action: () => Promise<T>): Promise<T> {
  const originalDescriptor = Object.getOwnPropertyDescriptor(Deno, "stdin");
  Object.defineProperty(Deno, "stdin", {
    ...originalDescriptor,
    value: stdin,
  });
  try {
    return await action();
  } finally {
    if (originalDescriptor) Object.defineProperty(Deno, "stdin", originalDescriptor);
  }
}

function assertSanitizedStdinError(error: unknown): void {
  if (!(error instanceof Error)) throw new Error("Expected stdin operation to reject with Error");
  assertEquals(error.message, "Failed to read from stdin");
}

async function withTimeout<T>(promise: Promise<T>): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => reject(new Error("Test promise did not settle")), 250);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

function createTestBuffer(timeouts: string[]): ReturnType<typeof createEscapeBuffer> {
  return createEscapeBuffer((key) => timeouts.push(key));
}

describe("getNodeStdinFromHost", () => {
  it("returns only a safely accessible stdin stream", () => {
    const stdin = new TestNodeStdin();
    assertEquals(getNodeStdinFromHost({ process: { stdin } }) === stdin, true);
    assertEquals(getNodeStdinFromHost({}), undefined);
    assertEquals(
      getNodeStdinFromHost(
        new Proxy({}, {
          get() {
            throw new Error("host access failed");
          },
        }),
      ),
      undefined,
    );
  });
});

describe("createNodeStdinReader", () => {
  it("settles concurrent reads in FIFO order", async () => {
    const stdin = new TestNodeStdin();
    const reader = createNodeStdinReader(stdin);

    try {
      const first = reader.read();
      const second = reader.read();

      stdin.emitData(new Uint8Array([1]));
      stdin.emitData(new Uint8Array([2]));

      assertEquals(await withTimeout(Promise.all([first, second])), [
        { value: new Uint8Array([1]), done: false },
        { value: new Uint8Array([2]), done: false },
      ]);
    } finally {
      reader.releaseLock();
    }
  });

  it("makes EOF durable after draining buffered data", async () => {
    const stdin = new TestNodeStdin();
    const reader = createNodeStdinReader(stdin);

    try {
      stdin.emitData(new Uint8Array([1]));
      stdin.emitEnd();

      assertEquals(await withTimeout(reader.read()), {
        value: new Uint8Array([1]),
        done: false,
      });
      assertEquals(await withTimeout(reader.read()), { value: undefined, done: true });
      assertEquals(await withTimeout(reader.read()), { value: undefined, done: true });
    } finally {
      reader.releaseLock();
    }
  });

  it("starts terminal when the stream already reached EOF", async () => {
    const stdin = new TestNodeStdin({ readableEnded: true });
    const reader = createNodeStdinReader(stdin);

    assertEquals(await withTimeout(reader.read()), { value: undefined, done: true });
    assertEquals(await withTimeout(reader.read()), { value: undefined, done: true });
    assertEquals(stdin.listenerCount("data"), 0);
    assertEquals(stdin.listenerCount("end"), 0);
    assertEquals(stdin.listenerCount("close"), 0);
    assertEquals(stdin.listenerCount("error"), 0);

    reader.releaseLock();
  });

  it("starts failed when the stream was destroyed by an error", async () => {
    const stdin = new TestNodeStdin({
      destroyed: true,
      errored: new Error("sensitive prior stream failure"),
      readableAborted: true,
    });
    const reader = createNodeStdinReader(stdin);

    const error = await assertRejects(
      () => withTimeout(reader.read()),
      Error,
      "Failed to read from stdin",
    );
    assertSanitizedStdinError(error);
    assertEquals(stdin.listenerCount("data"), 0);
    assertEquals(stdin.listenerCount("end"), 0);
    assertEquals(stdin.listenerCount("close"), 0);
    assertEquals(stdin.listenerCount("error"), 0);

    reader.releaseLock();
  });

  it("rejects pending and later reads when released", async () => {
    const stdin = new TestNodeStdin();
    const reader = createNodeStdinReader(stdin);
    const pendingRead = reader.read();

    reader.releaseLock();
    reader.releaseLock();

    await assertRejects(
      () => withTimeout(pendingRead),
      TypeError,
      "stdin reader was released",
    );
    await assertRejects(
      () => withTimeout(reader.read()),
      TypeError,
      "stdin reader was released",
    );
    assertEquals(stdin.listenerCount("data"), 0);
    assertEquals(stdin.listenerCount("end"), 0);
  });

  it("restores dormant flow state when released", () => {
    const stdin = new TestNodeStdin({ readableFlowing: null });
    const reader = createNodeStdinReader(stdin);

    assertEquals(stdin.readableFlowing, true);
    reader.releaseLock();

    assertEquals(stdin.readableFlowing, false);
    assertEquals(stdin.pauseCount, 1);
  });

  it("preserves flow state when the stream was already flowing", () => {
    const stdin = new TestNodeStdin({ readableFlowing: true });
    const reader = createNodeStdinReader(stdin);

    reader.releaseLock();

    assertEquals(stdin.readableFlowing, true);
    assertEquals(stdin.pauseCount, 0);
  });

  it("sanitizes flow restoration failures and stays released", async () => {
    const stdin = new TestNodeStdin({
      pause: () => {
        throw new Error("sensitive pause detail");
      },
    });
    const reader = createNodeStdinReader(stdin);

    assertThrows(
      () => reader.releaseLock(),
      Error,
      "Failed to release stdin reader",
    );
    reader.releaseLock();
    await assertRejects(
      () => reader.read(),
      TypeError,
      "stdin reader was released",
    );
    assertEquals(stdin.listenerCount("data"), 0);
    assertEquals(stdin.pauseCount, 1);
  });

  it("turns stream errors into a durable sanitized failure", async () => {
    const stdin = new TestNodeStdin();
    const reader = createNodeStdinReader(stdin);
    const pendingRead = reader.read();

    stdin.emitError(new Error("sensitive local stream detail"));

    const firstError = await assertRejects(
      () => withTimeout(pendingRead),
      Error,
      "Failed to read from stdin",
    );
    const laterError = await assertRejects(
      () => withTimeout(reader.read()),
      Error,
      "Failed to read from stdin",
    );
    assertSanitizedStdinError(firstError);
    assertSanitizedStdinError(laterError);
    assertEquals(stdin.listenerCount("data"), 0);
    assertEquals(stdin.listenerCount("end"), 0);
    assertEquals(stdin.listenerCount("close"), 0);
    assertEquals(stdin.listenerCount("error"), 0);

    reader.releaseLock();
  });

  it("rolls back listeners and sanitizes listener setup failures", () => {
    const stdin = new TestNodeStdin({
      on: (event) => {
        if (event === "error") throw new Error("sensitive listener setup detail");
      },
    });

    assertThrows(
      () => createNodeStdinReader(stdin),
      Error,
      "Failed to read from stdin",
    );
    assertEquals(stdin.listenerCount("data"), 0);
    assertEquals(stdin.listenerCount("end"), 0);
    assertEquals(stdin.listenerCount("close"), 0);
    assertEquals(stdin.listenerCount("error"), 0);
    assertEquals(stdin.readableFlowing, false);
    assertEquals(stdin.pauseCount, 1);
  });

  it("enforces one reader lock per Node stdin stream", () => {
    const stdin = new TestNodeStdin();
    const firstReader = createNodeStdinReader(stdin);

    assertThrows(
      () => createNodeStdinReader(stdin),
      TypeError,
      "stdin stream is already locked",
    );
    firstReader.releaseLock();

    const secondReader = createNodeStdinReader(stdin);
    secondReader.releaseLock();
  });
});

describe("createWebStdinReader", () => {
  it("turns native read errors into a durable sanitized failure", async () => {
    const nativeReader = new TestStreamReader(() =>
      Promise.reject(new Error("sensitive local stream detail"))
    );
    const reader = createWebStdinReader(nativeReader);

    const firstError = await assertRejects(
      () => reader.read(),
      Error,
      "Failed to read from stdin",
    );
    const laterError = await assertRejects(
      () => reader.read(),
      Error,
      "Failed to read from stdin",
    );
    assertSanitizedStdinError(firstError);
    assertSanitizedStdinError(laterError);
  });

  it("rejects pending and later reads when released", async () => {
    const nativeReader = new TestStreamReader(() => new Promise(() => {}));
    const reader = createWebStdinReader(nativeReader);
    const pendingRead = reader.read();

    reader.releaseLock();
    reader.releaseLock();

    await assertRejects(
      () => withTimeout(pendingRead),
      TypeError,
      "stdin reader was released",
    );
    await assertRejects(
      () => withTimeout(reader.read()),
      TypeError,
      "stdin reader was released",
    );
    assertEquals(nativeReader.releaseCount, 1);
  });

  it("sanitizes native release failures and stays released", async () => {
    const nativeReader = new TestStreamReader(
      () => Promise.resolve({ value: undefined, done: true }),
      () => {
        throw new Error("sensitive reader release detail");
      },
    );
    const reader = createWebStdinReader(nativeReader);

    assertThrows(
      () => reader.releaseLock(),
      Error,
      "Failed to release stdin reader",
    );
    reader.releaseLock();
    await assertRejects(
      () => reader.read(),
      TypeError,
      "stdin reader was released",
    );
    assertEquals(nativeReader.releaseCount, 1);
  });

  it("sanitizes hostile native read results without leaving reads pending", async () => {
    const nativeReader = new TestStreamReader(() =>
      Promise.resolve({
        get value(): Uint8Array | undefined {
          throw new Error("sensitive result getter detail");
        },
        done: false,
      })
    );
    const reader = createWebStdinReader(nativeReader);

    const firstError = await assertRejects(
      () => withTimeout(reader.read()),
      Error,
      "Failed to read from stdin",
    );
    const laterError = await assertRejects(
      () => withTimeout(reader.read()),
      Error,
      "Failed to read from stdin",
    );
    assertSanitizedStdinError(firstError);
    assertSanitizedStdinError(laterError);
  });
});

describe("Node stdin waits", () => {
  it("returns false and restores state when Enter-or-exit reaches EOF", async () => {
    const stdin = new TestNodeStdin();
    const pending = waitForNodeEnterOrExit(stdin);

    stdin.emitEnd();

    assertEquals(await withTimeout(pending), false);
    assertEquals(stdin.rawModes, [true, false]);
    assertEquals(stdin.resumeCount, 1);
    assertEquals(stdin.pauseCount, 1);
    assertEquals(stdin.listenerCount("data"), 0);
    assertEquals(stdin.listenerCount("end"), 0);
    assertEquals(stdin.listenerCount("close"), 0);
    assertEquals(stdin.listenerCount("error"), 0);
  });

  it("sanitizes Enter-or-exit stream failures and restores state", async () => {
    const stdin = new TestNodeStdin();
    const pending = waitForNodeEnterOrExit(stdin);

    stdin.emitError(new Error("sensitive local stream detail"));

    const error = await assertRejects(
      () => withTimeout(pending),
      Error,
      "Failed to read from stdin",
    );
    assertSanitizedStdinError(error);
    assertEquals(stdin.rawModes, [true, false]);
    assertEquals(stdin.resumeCount, 1);
    assertEquals(stdin.pauseCount, 1);
    assertEquals(stdin.listenerCount("data"), 0);
    assertEquals(stdin.listenerCount("end"), 0);
    assertEquals(stdin.listenerCount("close"), 0);
    assertEquals(stdin.listenerCount("error"), 0);
  });

  it("preserves an existing raw and flowing state and checks full chunks", async () => {
    const stdin = new TestNodeStdin({ isRaw: true, paused: false });
    const pending = waitForNodeEnterOrExit(stdin);

    stdin.emitData(new Uint8Array([0x78, 0x0d]));

    assertEquals(await withTimeout(pending), true);
    assertEquals(stdin.rawModes, []);
    assertEquals(stdin.resumeCount, 0);
    assertEquals(stdin.pauseCount, 0);
  });

  it("restores state and sanitizes raw mode setup failures", async () => {
    const stdin = new TestNodeStdin({
      setRawMode: (enabled) => {
        if (enabled) throw new Error("sensitive raw setup detail");
      },
    });

    const error = await assertRejects(
      () => waitForNodeEnterOrExit(stdin),
      Error,
      "Failed to read from stdin",
    );
    assertSanitizedStdinError(error);
    assertEquals(stdin.rawModes, [true, false]);
    assertEquals(stdin.listenerCount("data"), 0);
    assertEquals(stdin.listenerCount("end"), 0);
    assertEquals(stdin.listenerCount("close"), 0);
    assertEquals(stdin.listenerCount("error"), 0);
  });

  it("resolves keypress on EOF and restores state", async () => {
    const stdin = new TestNodeStdin();
    const pending = waitForNodeKeypress(stdin);

    stdin.emitEnd("close");

    await withTimeout(pending);
    assertEquals(stdin.rawModes, [true, false]);
    assertEquals(stdin.resumeCount, 1);
    assertEquals(stdin.pauseCount, 1);
    assertEquals(stdin.listenerCount("data"), 0);
    assertEquals(stdin.listenerCount("end"), 0);
    assertEquals(stdin.listenerCount("close"), 0);
    assertEquals(stdin.listenerCount("error"), 0);
  });

  it("sanitizes keypress stream failures and restores state", async () => {
    const stdin = new TestNodeStdin();
    const pending = waitForNodeKeypress(stdin);

    stdin.emitError(new Error("sensitive local stream detail"));

    const error = await assertRejects(
      () => withTimeout(pending),
      Error,
      "Failed to read from stdin",
    );
    assertSanitizedStdinError(error);
    assertEquals(stdin.rawModes, [true, false]);
    assertEquals(stdin.resumeCount, 1);
    assertEquals(stdin.pauseCount, 1);
  });

  it("serializes overlapping waits so cleanup cannot pause a peer", async () => {
    const stdin = new TestNodeStdin();
    const keypress = waitForNodeKeypress(stdin);
    const enterOrExit = waitForNodeEnterOrExit(stdin);

    stdin.emitFlowingData(new Uint8Array([0x78]));
    await withTimeout(keypress);
    await Promise.resolve();
    stdin.emitFlowingData(new Uint8Array([0x0d]));

    assertEquals(await withTimeout(enterOrExit), true);
    assertEquals(stdin.rawModes, [true, false, true, false]);
    assertEquals(stdin.resumeCount, 2);
    assertEquals(stdin.pauseCount, 2);
    assertEquals(stdin.listenerCount("data"), 0);
  });
});

describe("setRawMode", () => {
  it("rolls back and sanitizes Deno raw mode failures", async () => {
    const reader = new TestStreamReader(() => Promise.resolve({ value: undefined, done: true }));
    const stdin = new TestDenoStdin(reader, (enabled) => {
      if (enabled) throw new Error("sensitive raw setup detail");
    });

    const error = await assertRejects(
      () =>
        withTestDenoStdin(stdin, async () => {
          setRawMode(true);
        }),
      Error,
      "Failed to configure stdin",
    );
    if (!(error instanceof Error)) throw new Error("Expected stdin configuration Error");
    assertEquals(error.message, "Failed to configure stdin");
    assertEquals(stdin.rawModes, [true, false]);
  });

  it("restores a dormant Node stream after a raw mode session", () => {
    const stdin = new TestNodeStdin({ readableFlowing: null });

    setNodeStdinRawMode(stdin, true);
    assertEquals(stdin.readableFlowing, true);
    setNodeStdinRawMode(stdin, false);

    assertEquals(stdin.rawModes, [true, false]);
    assertEquals(stdin.readableFlowing, false);
    assertEquals(stdin.resumeCount, 1);
    assertEquals(stdin.pauseCount, 1);
  });

  it("preserves a Node stream that was already flowing", () => {
    const stdin = new TestNodeStdin({ readableFlowing: true });

    setNodeStdinRawMode(stdin, true);
    setNodeStdinRawMode(stdin, false);

    assertEquals(stdin.rawModes, [true, false]);
    assertEquals(stdin.readableFlowing, true);
    assertEquals(stdin.resumeCount, 0);
    assertEquals(stdin.pauseCount, 0);
  });

  it("rolls back Node raw and paused state when resume fails", () => {
    const stdin = new TestNodeStdin({
      resume: () => {
        throw new Error("sensitive resume detail");
      },
    });

    assertThrows(
      () => setNodeStdinRawMode(stdin, true),
      Error,
      "Failed to configure stdin",
    );
    assertEquals(stdin.rawModes, [true, false]);
    assertEquals(stdin.resumeCount, 1);
    assertEquals(stdin.pauseCount, 1);
  });

  it("rolls back and sanitizes Node raw mode failures", () => {
    const stdin = new TestNodeStdin({
      setRawMode: (enabled) => {
        if (enabled) throw new Error("sensitive raw setup detail");
      },
    });

    assertThrows(
      () => setNodeStdinRawMode(stdin, true),
      Error,
      "Failed to configure stdin",
    );
    assertEquals(stdin.rawModes, [true, false]);
    assertEquals(stdin.resumeCount, 0);
    assertEquals(stdin.pauseCount, 0);
  });

  it("sanitizes hostile Node raw mode capability access", () => {
    const stdin = new Proxy(new TestNodeStdin(), {
      get(target, property) {
        if (property === "setRawMode") throw new Error("sensitive capability detail");
        return Reflect.get(target, property, target);
      },
    });

    assertThrows(
      () => setNodeStdinRawMode(stdin, true),
      Error,
      "Failed to configure stdin",
    );
  });
});

describe("waitForEnterOrExit", () => {
  it("returns false and restores stdin when EOF arrives", async () => {
    const reader = new TestStreamReader(() => Promise.resolve({ value: undefined, done: true }));
    const stdin = new TestDenoStdin(reader);

    assertEquals(
      await withTestDenoStdin(stdin, () => withTimeout(waitForEnterOrExit())),
      false,
    );
    assertEquals(stdin.rawModes, [true, false]);
    assertEquals(reader.releaseCount, 1);
  });

  it("restores stdin and sanitizes reader failures", async () => {
    const reader = new TestStreamReader(() =>
      Promise.reject(new Error("sensitive local stream detail"))
    );
    const stdin = new TestDenoStdin(reader);

    const error = await assertRejects(
      () => withTestDenoStdin(stdin, () => waitForEnterOrExit()),
      Error,
      "Failed to read from stdin",
    );
    assertSanitizedStdinError(error);
    assertEquals(stdin.rawModes, [true, false]);
    assertEquals(reader.releaseCount, 1);
  });

  it("restores raw mode when reader acquisition fails", async () => {
    const stdin = new TestDenoStdin(() => {
      throw new Error("sensitive reader acquisition detail");
    });

    const error = await assertRejects(
      () => withTestDenoStdin(stdin, () => waitForEnterOrExit()),
      Error,
      "Failed to read from stdin",
    );
    assertSanitizedStdinError(error);
    assertEquals(stdin.rawModes, [true, false]);
  });

  it("attempts restoration when enabling raw mode fails", async () => {
    const reader = new TestStreamReader(() => Promise.resolve({ value: undefined, done: true }));
    const stdin = new TestDenoStdin(reader, (enabled) => {
      if (enabled) throw new Error("sensitive raw setup detail");
    });

    const error = await assertRejects(
      () => withTestDenoStdin(stdin, () => waitForEnterOrExit()),
      Error,
      "Failed to read from stdin",
    );
    assertSanitizedStdinError(error);
    assertEquals(stdin.rawModes, [true, false]);
    assertEquals(reader.releaseCount, 0);
  });

  it("releases the reader when raw mode restoration fails", async () => {
    const reader = new TestStreamReader(() => Promise.resolve({ value: undefined, done: true }));
    const stdin = new TestDenoStdin(reader, (enabled) => {
      if (!enabled) throw new Error("sensitive raw cleanup detail");
    });

    const error = await assertRejects(
      () => withTestDenoStdin(stdin, () => waitForEnterOrExit()),
      Error,
      "Failed to read from stdin",
    );
    assertSanitizedStdinError(error);
    assertEquals(stdin.rawModes, [true, false]);
    assertEquals(reader.releaseCount, 1);
  });

  it("sanitizes reader release failures after restoring raw mode", async () => {
    const reader = new TestStreamReader(
      () => Promise.resolve({ value: undefined, done: true }),
      () => {
        throw new Error("sensitive reader release detail");
      },
    );
    const stdin = new TestDenoStdin(reader);

    const error = await assertRejects(
      () => withTestDenoStdin(stdin, () => waitForEnterOrExit()),
      Error,
      "Failed to read from stdin",
    );
    assertSanitizedStdinError(error);
    assertEquals(stdin.rawModes, [true, false]);
    assertEquals(reader.releaseCount, 1);
  });

  it("preserves raw mode that was enabled through the compatibility API", async () => {
    const reader = new TestStreamReader(() => Promise.resolve({ value: undefined, done: true }));
    const stdin = new TestDenoStdin(reader);

    await withTestDenoStdin(stdin, async () => {
      setRawMode(true);
      try {
        assertEquals(await waitForEnterOrExit(), false);
        assertEquals(stdin.rawModes, [true]);
      } finally {
        setRawMode(false);
      }
    });

    assertEquals(stdin.rawModes, [true, false]);
    assertEquals(reader.releaseCount, 1);
  });

  it("checks every byte in a chunk for Enter", async () => {
    let readCount = 0;
    const reader = new TestStreamReader(() => {
      readCount += 1;
      return Promise.resolve(
        readCount === 1
          ? { value: new Uint8Array([0x78, 0x0d]), done: false }
          : { value: undefined, done: true },
      );
    });
    const stdin = new TestDenoStdin(reader);

    assertEquals(
      await withTestDenoStdin(stdin, () => waitForEnterOrExit()),
      true,
    );
    assertEquals(readCount, 1);
  });
});

describe("waitForKeypress", () => {
  it("restores raw mode when reader acquisition fails", async () => {
    const stdin = new TestDenoStdin(() => {
      throw new Error("sensitive reader acquisition detail");
    });

    const error = await assertRejects(
      () => withTestDenoStdin(stdin, () => waitForKeypress()),
      Error,
      "Failed to read from stdin",
    );
    assertSanitizedStdinError(error);
    assertEquals(stdin.rawModes, [true, false]);
  });

  it("restores stdin and sanitizes reader failures", async () => {
    const reader = new TestStreamReader(() =>
      Promise.reject(new Error("sensitive local stream detail"))
    );
    const stdin = new TestDenoStdin(reader);

    const error = await assertRejects(
      () => withTestDenoStdin(stdin, () => waitForKeypress()),
      Error,
      "Failed to read from stdin",
    );
    assertSanitizedStdinError(error);
    assertEquals(stdin.rawModes, [true, false]);
    assertEquals(reader.releaseCount, 1);
  });

  it("serializes overlapping Deno waits around the stream lock", async () => {
    let locked = false;
    let acquisitionCount = 0;
    let resolveRead: ((result: { value: Uint8Array; done: boolean }) => void) | undefined;
    const stdin = new TestDenoStdin(() => {
      if (locked) throw new Error("stdin stream is already locked");
      locked = true;
      acquisitionCount += 1;
      return new TestStreamReader(
        () =>
          new Promise((resolve) => {
            resolveRead = resolve;
          }),
        () => {
          locked = false;
        },
      );
    });

    await withTestDenoStdin(stdin, async () => {
      const keypress = waitForKeypress();
      const enterOrExit = waitForEnterOrExit();

      resolveRead?.({ value: new Uint8Array([0x78]), done: false });
      await withTimeout(keypress);
      await Promise.resolve();
      resolveRead?.({ value: new Uint8Array([0x0d]), done: false });

      assertEquals(await withTimeout(enterOrExit), true);
    });

    assertEquals(acquisitionCount, 2);
    assertEquals(stdin.rawModes, [true, false, true, false]);
  });
});

describe("createEscapeBuffer", () => {
  it("should pass through regular characters immediately", () => {
    const timeouts: string[] = [];
    const buffer = createTestBuffer(timeouts);

    assertEquals(buffer.push("a"), "a");
    assertEquals(buffer.push("b"), "b");
    assertEquals(buffer.push("1"), "1");
    assertEquals(timeouts, []);

    buffer.clear();
  });

  it("should buffer escape and combine with following input", () => {
    const timeouts: string[] = [];
    const buffer = createTestBuffer(timeouts);

    assertEquals(buffer.push("\x1b"), null);
    assertEquals(buffer.push("[A"), "\x1b[A");
    assertEquals(timeouts, []);

    buffer.clear();
  });

  it("should pass through complete escape sequences", () => {
    const timeouts: string[] = [];
    const buffer = createTestBuffer(timeouts);

    assertEquals(buffer.push("\x1b[A"), "\x1b[A");
    assertEquals(buffer.push("\x1b[B"), "\x1b[B");
    assertEquals(timeouts, []);

    buffer.clear();
  });

  it("should timeout standalone escape key", async () => {
    const timeouts: string[] = [];
    const buffer = createTestBuffer(timeouts);

    assertEquals(buffer.push("\x1b"), null);

    await new Promise((r) => setTimeout(r, 100));

    assertEquals(timeouts, ["\x1b"]);

    buffer.clear();
  });

  it("should clear pending escape", () => {
    const timeouts: string[] = [];
    const buffer = createTestBuffer(timeouts);

    assertEquals(buffer.push("\x1b"), null);
    buffer.clear();

    assertEquals(buffer.push("a"), "a");
    assertEquals(timeouts, []);
  });
});

import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createEscapeBuffer,
  createNodeStdinReader,
  type NodeStdinLike,
  readStdinLine,
  setNodeRawMode,
  type StdinReader,
  waitForNodeKeypress,
} from "./stdin.ts";

function createFakeStdin(): {
  stdin: NodeStdinLike;
  emitData(data: Uint8Array): void;
  emitEnd(): void;
  emitError(error: unknown): void;
} {
  const dataListeners = new Set<(data: Uint8Array) => void>();
  const endListeners = new Set<() => void>();
  const errorListeners = new Set<(error: unknown) => void>();

  const stdin = {
    resume() {},
    pause() {},
    on(event: string, listener: unknown) {
      if (event === "data") dataListeners.add(listener as (data: Uint8Array) => void);
      if (event === "end") endListeners.add(listener as () => void);
      if (event === "error") errorListeners.add(listener as (error: unknown) => void);
    },
    off(event: string, listener: unknown) {
      if (event === "data") dataListeners.delete(listener as (data: Uint8Array) => void);
      if (event === "end") endListeners.delete(listener as () => void);
      if (event === "error") errorListeners.delete(listener as (error: unknown) => void);
    },
  } as NodeStdinLike;

  return {
    stdin,
    emitData(data) {
      for (const listener of dataListeners) listener(data);
    },
    emitEnd() {
      for (const listener of endListeners) listener();
    },
    emitError(error) {
      for (const listener of errorListeners) listener(error);
    },
  };
}

function createTestBuffer(timeouts: string[]): ReturnType<typeof createEscapeBuffer> {
  return createEscapeBuffer((key) => timeouts.push(key));
}

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

describe("createNodeStdinReader", () => {
  it("queues concurrent reads without replacing an earlier waiter", async () => {
    const fake = createFakeStdin();
    const reader = createNodeStdinReader(fake.stdin);
    const first = reader.read();
    const second = reader.read();

    fake.emitData(new Uint8Array([1]));
    fake.emitData(new Uint8Array([2]));

    assertEquals(await first, { value: new Uint8Array([1]), done: false });
    assertEquals(await second, { value: new Uint8Array([2]), done: false });
    reader.releaseLock();
  });

  it("settles pending and future reads when the stream ends", async () => {
    const fake = createFakeStdin();
    const reader = createNodeStdinReader(fake.stdin);
    const pending = reader.read();

    fake.emitEnd();

    assertEquals(await pending, { value: undefined, done: true });
    assertEquals(await reader.read(), { value: undefined, done: true });
  });

  it("settles a pending read when its lock is released", async () => {
    const fake = createFakeStdin();
    const reader = createNodeStdinReader(fake.stdin);
    const pending = reader.read();

    reader.releaseLock();

    assertEquals(await pending, { value: undefined, done: true });
  });

  it("rejects pending and future reads after a stream error", async () => {
    const fake = createFakeStdin();
    const reader = createNodeStdinReader(fake.stdin);
    const pending = reader.read();

    fake.emitError(new Error("stdin failed"));

    await assertRejects(() => pending, Error, "stdin failed");
    await assertRejects(() => reader.read(), Error, "stdin failed");
  });
});

describe("readStdinLine", () => {
  it("reads a line split across Node-style stdin chunks", async () => {
    const encoder = new TextEncoder();
    const chunks = [encoder.encode("y"), encoder.encode("es\r\nignored")];
    let released = false;
    const reader: StdinReader = {
      read: () => {
        const value = chunks.shift();
        return Promise.resolve({ value, done: value === undefined });
      },
      releaseLock: () => {
        released = true;
      },
    };

    assertEquals(await readStdinLine(reader), "yes");
    assertEquals(released, true);
  });

  it("returns null when stdin closes before receiving input", async () => {
    let released = false;
    const reader: StdinReader = {
      read: () => Promise.resolve({ value: undefined, done: true }),
      releaseLock: () => {
        released = true;
      },
    };

    assertEquals(await readStdinLine(reader), null);
    assertEquals(released, true);
  });

  it("decodes the final value returned with EOF", async () => {
    const reader: StdinReader = {
      read: () =>
        Promise.resolve({
          value: new TextEncoder().encode("yes\n"),
          done: true,
        }),
      releaseLock: () => {},
    };

    assertEquals(await readStdinLine(reader), "yes");
  });

  it("returns the final unterminated line at EOF", async () => {
    const chunks = [new TextEncoder().encode("yes")];
    let released = false;
    const reader: StdinReader = {
      read: () => {
        const value = chunks.shift();
        return Promise.resolve({ value, done: value === undefined });
      },
      releaseLock: () => {
        released = true;
      },
    };

    assertEquals(
      await readStdinLine(reader),
      "yes",
      "input with no trailing newline must be returned at EOF",
    );
    assertEquals(released, true, "the reader lock must be released");
  });
});

describe("createNodeStdinReader", () => {
  it("attaches reader listeners before resuming raw-mode Node stdin", () => {
    const events: string[] = [];
    const listeners = new Map<string, (data: Uint8Array) => void>();
    const stdin = {
      on: (event: string, listener: (data: Uint8Array) => void) => {
        events.push(`on:${event}`);
        listeners.set(event, listener);
      },
      off: (event: string) => {
        listeners.delete(event);
      },
      pause: () => {},
      resume: () => {
        events.push("resume");
      },
      setRawMode: (enabled: boolean) => {
        events.push(`raw:${enabled}`);
      },
    };

    setNodeRawMode(stdin, true);
    const reader = createNodeStdinReader(stdin);

    assertEquals(events, [
      "raw:true",
      "on:data",
      "on:end",
      "on:error",
      "resume",
    ]);
    reader.releaseLock();
  });

  it("resumes stdin while reading and pauses it when released", async () => {
    const listeners = new Map<string, (data: Uint8Array) => void>();
    let resumedAfterListenersAttached = false;
    let paused = false;
    const reader = createNodeStdinReader({
      on: (event, listener) => {
        listeners.set(event, listener);
      },
      off: (event) => {
        listeners.delete(event);
      },
      pause: () => {
        paused = true;
      },
      resume: () => {
        resumedAfterListenersAttached = listeners.has("data") && listeners.has("end");
      },
    });

    assertEquals(resumedAfterListenersAttached, true);
    const read = reader.read();
    listeners.get("data")?.(new TextEncoder().encode("yes\n"));

    assertEquals(await read, {
      value: new TextEncoder().encode("yes\n"),
      done: false,
    });
    reader.releaseLock();
    assertEquals(paused, true);
    assertEquals(listeners.size, 0);
  });

  it("reports EOF after draining a buffered partial line", async () => {
    const listeners = new Map<string, (data: Uint8Array) => void>();
    const reader = createNodeStdinReader({
      on: (event, listener) => {
        listeners.set(event, listener);
      },
      off: (event) => {
        listeners.delete(event);
      },
      pause: () => {},
      resume: () => {},
    });

    const firstRead = reader.read();
    listeners.get("data")?.(new TextEncoder().encode("partial"));
    assertEquals(await firstRead, {
      value: new TextEncoder().encode("partial"),
      done: false,
    });
    listeners.get("end")?.(new Uint8Array());

    assertEquals(await reader.read(), { value: undefined, done: true });
    reader.releaseLock();
  });

  it("pauses stdin at the buffer cap and resumes once it drains", async () => {
    const listeners = new Map<string, (data: Uint8Array) => void>();
    let pauseCalls = 0;
    let resumeCalls = 0;
    const reader = createNodeStdinReader({
      on: (event, listener) => {
        listeners.set(event, listener);
      },
      off: (event) => {
        listeners.delete(event);
      },
      pause: () => {
        pauseCalls++;
      },
      resume: () => {
        resumeCalls++;
      },
    });
    const resumesAfterAttach = resumeCalls;

    listeners.get("data")?.(new Uint8Array(1024 * 1024));
    assertEquals(pauseCalls, 1, "stdin must pause once the unread buffer reaches the 1 MiB cap");
    listeners.get("data")?.(new Uint8Array(1));
    assertEquals(pauseCalls, 1, "stdin must not be paused again while already paused");

    const first = await reader.read();
    assertEquals(first.value?.byteLength, 1024 * 1024, "the buffered chunk is drained first");
    assertEquals(
      resumeCalls,
      resumesAfterAttach + 1,
      "stdin must resume once the buffer drains below half the cap",
    );

    reader.releaseLock();
  });

  it("settles a pending read as EOF when released", async () => {
    const listeners = new Map<string, (data: Uint8Array) => void>();
    const reader = createNodeStdinReader({
      on: (event, listener) => {
        listeners.set(event, listener);
      },
      off: (event) => {
        listeners.delete(event);
      },
      pause: () => {},
      resume: () => {},
    });

    const pendingRead = reader.read();
    reader.releaseLock();

    let timeoutId: number | undefined;
    const result = await Promise.race([
      pendingRead,
      new Promise<"timeout">((resolve) => {
        timeoutId = setTimeout(() => resolve("timeout"), 20);
      }),
    ]);
    clearTimeout(timeoutId);
    assertEquals(result, { value: undefined, done: true });
  });
});

describe("waitForNodeKeypress", () => {
  it("attaches the data listener before resuming stdin", async () => {
    const events: string[] = [];
    let onData: ((data: Uint8Array) => void) | undefined;
    const wait = waitForNodeKeypress({
      once: (event, listener) => {
        events.push(`once:${event}`);
        onData = listener;
      },
      pause: () => {
        events.push("pause");
      },
      resume: () => {
        events.push("resume");
      },
      setRawMode: (enabled) => {
        events.push(`raw:${enabled}`);
      },
    });

    assertEquals(events, ["once:data", "raw:true", "resume"]);
    onData?.(new Uint8Array([0x0a]));
    await wait;
    assertEquals(events, ["once:data", "raw:true", "resume", "raw:false", "pause"]);
  });
});

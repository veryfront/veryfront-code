import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createEscapeBuffer, createNodeStdinReader, type NodeStdinLike } from "./stdin.ts";

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

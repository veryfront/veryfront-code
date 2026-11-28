import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isBun } from "../runtime.ts";
import {
  getV8HeapSizeLimit,
  makeStdioWritesBlocking,
  type NodeReadSyncFs,
  testReadStdinByteSyncNode,
} from "#veryfront/platform/compat/process/lifecycle.ts";

function errorWithCode(code: string): Error {
  return Object.assign(new Error(code), { code });
}

/** A node:fs stand-in that replays a scripted sequence of readSync outcomes. */
function fakeFs(steps: Array<number | Error>): NodeReadSyncFs {
  let index = 0;
  return {
    readSync(_fd, buffer, offset, _length, _position) {
      const step = steps[index++];
      if (step instanceof Error) throw step;
      buffer[offset] = step ?? 0;
      return step === undefined ? 0 : 1;
    },
  };
}

describe("platform/compat/process/lifecycle", () => {
  it("rejects Bun's moving node:v8 compatibility heap limit", () => {
    if (!isBun) return;
    assertEquals(
      getV8HeapSizeLimit(),
      undefined,
      "Bun's process-derived node:v8 shim value is not a fixed heap ceiling",
    );
  });

  it("reads one byte from a Node stdin fd", () => {
    assertEquals(testReadStdinByteSyncNode(fakeFs([0x41]), new Uint8Array(1), () => {}), 0x41);
  });

  it("keeps waiting through EAGAIN instead of reporting EOF", () => {
    const sleeps: number[] = [];
    const byte = testReadStdinByteSyncNode(
      fakeFs([errorWithCode("EAGAIN"), errorWithCode("EAGAIN"), 0x42]),
      new Uint8Array(1),
      (ms) => sleeps.push(ms),
    );

    assertEquals(byte, 0x42, "a raw TTY yields EAGAIN until the user types");
    assertEquals(sleeps, [5, 5], "each EAGAIN parks 5ms before retrying");
  });

  it("reports EOF when a read returns zero bytes", () => {
    assertEquals(testReadStdinByteSyncNode(fakeFs([]), new Uint8Array(1), () => {}), null);
  });

  it("reports EOF when stdin is closed", () => {
    assertEquals(
      testReadStdinByteSyncNode(fakeFs([errorWithCode("EOF")]), new Uint8Array(1), () => {}),
      null,
    );
  });

  describe("makeStdioWritesBlocking", () => {
    type StdioHost = NonNullable<Parameters<typeof makeStdioWritesBlocking>[0]>;

    /** A Node stdio stream whose libuv handle records each setBlocking call. */
    function pipeStream(calls: boolean[]): { _handle: { setBlocking(b: boolean): number } } {
      return {
        _handle: {
          setBlocking(blocking: boolean) {
            calls.push(blocking);
            return 0;
          },
        },
      };
    }

    function host(stdout: unknown, stderr: unknown): StdioHost {
      return { stdout, stderr } as unknown as StdioHost;
    }

    it("makes both stdout and stderr pipe handles blocking", () => {
      const stdoutCalls: boolean[] = [];
      const stderrCalls: boolean[] = [];

      makeStdioWritesBlocking(host(pipeStream(stdoutCalls), pipeStream(stderrCalls)));

      assertEquals(stdoutCalls, [true], "stdout carries the answer a pipe reader parses");
      assertEquals(stderrCalls, [true], "stderr carries the error a failing exit prints");
    });

    it("stays blocking when called again", () => {
      const calls: boolean[] = [];
      const stdio = host(pipeStream(calls), pipeStream([]));

      makeStdioWritesBlocking(stdio);
      makeStdioWritesBlocking(stdio);

      assertEquals(calls, [true, true], "a second call never switches a handle back");
    });

    it("leaves a file stream alone, which Node already writes synchronously", () => {
      const stderrCalls: boolean[] = [];

      // Node's SyncWriteStream for a file has no libuv handle.
      makeStdioWritesBlocking(host({ fd: 1 }, pipeStream(stderrCalls)));

      assertEquals(stderrCalls, [true], "the other stream still becomes blocking");
    });

    it("leaves a handle without setBlocking alone, as under Bun", () => {
      const stdoutCalls: boolean[] = [];

      makeStdioWritesBlocking(host(pipeStream(stdoutCalls), { _handle: {} }));

      assertEquals(stdoutCalls, [true]);
    });

    it("does nothing without a Node process, as under Deno", () => {
      makeStdioWritesBlocking(null);
    });
  });
});

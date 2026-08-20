import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isBun } from "../runtime.ts";
import { getV8HeapSizeLimit, type NodeReadSyncFs, testReadStdinByteSyncNode } from "./lifecycle.ts";

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
    assertEquals(sleeps.length, 2, "each EAGAIN parks before retrying");
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
});

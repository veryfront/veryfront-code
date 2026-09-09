import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getPrivateAsyncIterator } from "./private-iterator.ts";

describe("private async iterators", () => {
  it("preserves next input, returned values, and generator cleanup", async () => {
    let cleaned = false;
    const source = (async function* (): AsyncGenerator<string, string, string> {
      try {
        const input = yield "first";
        yield input;
        return "finished";
      } finally {
        cleaned = true;
      }
    })();
    const iterator = getPrivateAsyncIterator(source);
    assertEquals(await iterator.next(), { done: false, value: "first" });
    assertEquals(await iterator.next("second"), { done: false, value: "second" });
    assertEquals(await iterator.return!("stopped"), { done: true, value: "stopped" });
    assertEquals(cleaned, true);
  });

  it("forwards thrown errors and still joins generator finalization", async () => {
    let cleaned = false;
    const iterator = getPrivateAsyncIterator((async function* () {
      try {
        yield "first";
      } finally {
        cleaned = true;
      }
    })());
    await iterator.next();
    await assertRejects(() => iterator.throw!(new Error("Synthetic iterator failure")), Error);
    assertEquals(cleaned, true);
  });

  it("preserves custom iterator receivers and optional cleanup methods", async () => {
    let calls = 0;
    const source: AsyncIterableIterator<number> = {
      next() {
        assertEquals(this, source);
        return Promise.resolve({ done: calls++ > 0, value: 1 });
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    };
    const iterator = getPrivateAsyncIterator(source);
    source.next = () => Promise.reject(new Error("Unexpected replacement"));
    assertEquals(await Array.fromAsync(iterator), [1]);
    assertEquals(iterator.return, undefined);
    assertEquals(iterator.throw, undefined);
  });
});

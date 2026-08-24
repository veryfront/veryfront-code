import { assertEquals, assertRejects, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { AgentRunEventSink } from "./model-call-context.ts";
import {
  getActiveRunEventSink,
  getActiveRunEventSinks,
  runWithMandatoryRunEventSink,
  runWithRunEventSink,
  scopeAsyncIterableWithMandatoryRunEventSink,
  scopeAsyncIterableWithRunEventSink,
} from "./run-event-sink-context.ts";

const publicSink: AgentRunEventSink = () => {};
const mandatorySink: AgentRunEventSink = () => {};

describe("run event sink context", () => {
  it("keeps mandatory and public lanes independent and restores outer scopes", () => {
    assertEquals(getActiveRunEventSinks(), { mandatory: undefined, public: undefined });

    runWithMandatoryRunEventSink(mandatorySink, () => {
      assertStrictEquals(getActiveRunEventSink(), mandatorySink);
      assertEquals(getActiveRunEventSinks(), { mandatory: mandatorySink, public: undefined });

      runWithRunEventSink(publicSink, () => {
        assertStrictEquals(getActiveRunEventSink(), publicSink);
        assertEquals(getActiveRunEventSinks(), {
          mandatory: mandatorySink,
          public: publicSink,
        });
      });

      assertStrictEquals(getActiveRunEventSink(), mandatorySink);
    });

    assertEquals(getActiveRunEventSinks(), { mandatory: undefined, public: undefined });
  });

  it("scopes public sink context across lazy iterator creation and next", async () => {
    const observed: Array<AgentRunEventSink | undefined> = [];
    const source: AsyncIterable<string> = {
      [Symbol.asyncIterator]() {
        observed.push(getActiveRunEventSinks().public);
        return {
          next() {
            observed.push(getActiveRunEventSinks().public);
            return Promise.resolve({ value: "value", done: false });
          },
        };
      },
    };

    const iterator = scopeAsyncIterableWithRunEventSink(publicSink, source)[Symbol.asyncIterator]();
    assertEquals(await iterator.next(), { value: "value", done: false });
    assertEquals(observed, [publicSink, publicSink]);
    assertEquals(getActiveRunEventSinks().public, undefined);
  });

  it("scopes mandatory sink context across iterator return and throw", async () => {
    const observed: string[] = [];
    const failure = new Error("iterator failure");
    const source: AsyncIterable<string> = {
      [Symbol.asyncIterator]() {
        return {
          next: () => Promise.resolve({ value: "value", done: false }),
          return(value?: unknown) {
            if (getActiveRunEventSinks().mandatory === mandatorySink) observed.push("return");
            return Promise.resolve({ value: String(value), done: true });
          },
          throw(error?: unknown) {
            if (getActiveRunEventSinks().mandatory === mandatorySink) observed.push("throw");
            return Promise.reject(error);
          },
        };
      },
    };

    const wrapped = scopeAsyncIterableWithMandatoryRunEventSink(mandatorySink, source);
    const returned = wrapped[Symbol.asyncIterator]();
    assertEquals(await returned.return?.("done"), { value: "done", done: true });
    const thrown = wrapped[Symbol.asyncIterator]();
    const rejected = await assertRejects(
      () => thrown.throw?.(failure) as Promise<IteratorResult<string>>,
      Error,
      "iterator failure",
    );
    assertStrictEquals(rejected, failure);
    assertEquals(observed, ["return", "throw"]);
    assertEquals(getActiveRunEventSinks().mandatory, undefined);
  });
});

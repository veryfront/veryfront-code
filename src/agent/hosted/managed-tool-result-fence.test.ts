import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  bindSyntheticToolResultRecovery,
  bindToolResultSequence,
} from "#veryfront/runtime/tool-result-sequence.ts";
import { createManagedToolResultFence } from "./managed-tool-result-fence.ts";

const deadline = () => Date.now() + 1_000;
const signal = () => new AbortController().signal;

function result(sessionId: string, ordinal: number) {
  const chunk = {
    type: "tool-output-available" as const,
    toolCallId: `call-${ordinal}`,
    output: { ok: true },
  };
  bindToolResultSequence(chunk, { sessionId, ordinal });
  return chunk;
}

describe("managed tool result fence", () => {
  it("allows historical startup at host position zero", async () => {
    const fence = createManagedToolResultFence();
    const sessionId = fence.beginSession();
    await fence.waitBeforeContext({ sessionId, ordinal: 0 }, signal(), deadline());
  });

  it("waits outside persistence and releases only after an acknowledged result", async () => {
    const fence = createManagedToolResultFence();
    const sessionId = fence.beginSession();
    let released = false;
    const pending = fence.waitBeforeContext({ sessionId, ordinal: 1 }, signal(), deadline())
      .then(() => {
        released = true;
      });
    await Promise.resolve();
    assertEquals(released, false);
    fence.resultPersisted(result(sessionId, 1));
    await pending;
    assertEquals(released, true);
  });

  it("does not advance the producer watermark for converter-only orphan recovery", async () => {
    const fence = createManagedToolResultFence();
    const sessionId = fence.beginSession();
    const recovery = {
      type: "tool-input-error" as const,
      toolCallId: "orphan",
      toolName: "unknown",
      input: {},
      errorText: "Incomplete tool input",
    };
    bindSyntheticToolResultRecovery(recovery);
    fence.resultPersisted(recovery);
    await fence.waitBeforeContext({ sessionId, ordinal: 0 }, signal(), deadline());
    fence.resultPersisted(result(sessionId, 1));
  });

  it("rejects absent, foreign, or out-of-order producer positions", async () => {
    const fence = createManagedToolResultFence();
    const sessionId = fence.beginSession();
    await assertRejects(() => fence.waitBeforeContext(undefined, signal(), deadline()));
    await assertRejects(() =>
      fence.waitBeforeContext({ sessionId: crypto.randomUUID(), ordinal: 0 }, signal(), deadline())
    );
    await assertRejects(async () =>
      fence.resultPersisted({
        type: "tool-output-available",
        toolCallId: "missing",
        output: {},
      })
    );
    await assertRejects(async () => fence.resultPersisted(result(sessionId, 2)));
    fence.resultPersisted(result(sessionId, 1));
    await assertRejects(async () => fence.resultPersisted(result(sessionId, 1)));
  });

  it("rejects a foreign output even if its ordinal would satisfy a waiting model call", async () => {
    const fence = createManagedToolResultFence();
    const sessionId = fence.beginSession();
    const pending = fence.waitBeforeContext({ sessionId, ordinal: 1 }, signal(), deadline());
    await assertRejects(async () => fence.resultPersisted(result(crypto.randomUUID(), 1)));
    fence.fail(new Error("invalid output"));
    await assertRejects(() => pending);
  });

  it("cancels and times out pending context waits", async () => {
    const fence = createManagedToolResultFence();
    const sessionId = fence.beginSession();
    const controller = new AbortController();
    const cancelled = fence.waitBeforeContext(
      { sessionId, ordinal: 1 },
      controller.signal,
      deadline(),
    );
    controller.abort(new Error("cancelled"));
    await assertRejects(() => cancelled);
    await assertRejects(() =>
      fence.waitBeforeContext(
        { sessionId, ordinal: 0 },
        controller.signal,
        deadline(),
      )
    );
    await assertRejects(() =>
      fence.waitBeforeContext({ sessionId, ordinal: 0 }, signal(), Date.now() - 1)
    );
    await assertRejects(() =>
      fence.waitBeforeContext({ sessionId, ordinal: 1 }, signal(), Date.now() - 1)
    );
  });

  it("propagates persistence failure to current and future waiters", async () => {
    const fence = createManagedToolResultFence();
    const sessionId = fence.beginSession();
    const pending = fence.waitBeforeContext({ sessionId, ordinal: 1 }, signal(), deadline());
    fence.fail(new Error("append failed"));
    await assertRejects(() => pending);
    await assertRejects(() =>
      fence.waitBeforeContext({ sessionId, ordinal: 0 }, signal(), deadline())
    );
  });

  for (const failure of [undefined, false]) {
    it(`preserves a falsey failure ${String(failure)} for pending and later calls`, async () => {
      const fence = createManagedToolResultFence();
      const sessionId = fence.beginSession();
      const pending = fence.waitBeforeContext({ sessionId, ordinal: 1 }, signal(), deadline());
      fence.fail(failure);
      const reason = await pending.then(
        () => "unexpected resolution",
        (error) => error,
      );
      assertEquals(reason, failure);
      const later = await fence.waitBeforeContext(
        { sessionId, ordinal: 0 },
        signal(),
        deadline(),
      ).then(
        () => "unexpected resolution",
        (error) => error,
      );
      assertEquals(later, failure);
      let rejected = false;
      try {
        fence.resultPersisted(result(sessionId, 1));
      } catch (error) {
        rejected = true;
        assertEquals(error, failure);
      }
      assertEquals(rejected, true);
      await assertRejects(async () => fence.beginSession());
    });
  }
});

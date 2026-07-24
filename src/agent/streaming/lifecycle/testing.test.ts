import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createScriptedStreamProvider, ManualMonotonicClock } from "./testing.ts";

describe("stream lifecycle testing adapters", () => {
  it("releases only deadlines reached by a monotonic advance", async () => {
    const clock = new ManualMonotonicClock();
    const first = clock.waitUntil(10);
    const second = clock.waitUntil(20);
    clock.advanceBy(10);
    assertEquals(await first, "deadline");
    assertEquals(clock.pendingWaitCount, 1);
    clock.advanceBy(10);
    assertEquals(await second, "deadline");
  });

  it("records one provider open and one cleanup request", async () => {
    const provider = createScriptedStreamProvider([{
      type: "text-delta",
      text: "ok",
    }]);
    const iterator = provider.open(new AbortController().signal)
      [Symbol.asyncIterator]();
    await iterator.next();
    await iterator.return?.();
    assertEquals(provider.openCount, 1);
    assertEquals(provider.returnCount, 1);
  });

  it("removes provider abort listeners after natural completion", async () => {
    const signal = createAbortListenerCountingSignal();
    const provider = createScriptedStreamProvider([]);
    const iterator = provider.open(signal)[Symbol.asyncIterator]();

    assertEquals(signal.activeAbortListenerCount(), 1);
    assertEquals(await iterator.next(), { done: true, value: undefined });
    assertEquals(signal.activeAbortListenerCount(), 0);
  });

  it("removes provider abort listeners after abort completion", async () => {
    const controller = new AbortController();
    const signal = createAbortListenerCountingSignal(controller);
    const provider = createScriptedStreamProvider([], { autoComplete: false });
    const iterator = provider.open(signal)[Symbol.asyncIterator]();
    const pending = iterator.next();

    assertEquals(signal.activeAbortListenerCount(), 1);
    controller.abort();

    assertEquals(await pending, { done: true, value: undefined });
    assertEquals(signal.activeAbortListenerCount(), 0);
  });
});

function createAbortListenerCountingSignal(
  controller = new AbortController(),
): AbortSignal & { activeAbortListenerCount(): number } {
  const signal = controller.signal as AbortSignal & {
    activeAbortListenerCount(): number;
  };
  const addEventListener = signal.addEventListener.bind(signal);
  const removeEventListener = signal.removeEventListener.bind(signal);
  let activeAbortListeners = 0;

  Object.defineProperty(signal, "addEventListener", {
    value(
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ) {
      if (type === "abort") activeAbortListeners++;
      return addEventListener(type, listener, options);
    },
  });
  Object.defineProperty(signal, "removeEventListener", {
    value(
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | EventListenerOptions,
    ) {
      if (type === "abort") activeAbortListeners--;
      return removeEventListener(type, listener, options);
    },
  });
  signal.activeAbortListenerCount = () => activeAbortListeners;
  return signal;
}

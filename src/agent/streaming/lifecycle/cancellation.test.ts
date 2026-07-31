import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createCancellationCoordinator } from "./cancellation.ts";

describe("createCancellationCoordinator", () => {
  it("removes every input listener as soon as one source wins", () => {
    const runtime = createAbortListenerCountingController();
    const client = createAbortListenerCountingController();
    const selected: string[] = [];
    const coordinator = createCancellationCoordinator([
      { source: "runtime", signal: runtime.signal },
      { source: "client_disconnected", signal: client.signal },
    ], (source) => selected.push(source));

    assertEquals(runtime.activeAbortListenerCount(), 1);
    assertEquals(client.activeAbortListenerCount(), 1);

    runtime.abort("runtime stop");

    assertEquals(selected, ["runtime"]);
    assertEquals(coordinator.source, "runtime");
    assertEquals(runtime.activeAbortListenerCount(), 0);
    assertEquals(client.activeAbortListenerCount(), 0);

    client.abort("client stop");
    coordinator.dispose();
    assertEquals(selected, ["runtime"]);
    assertEquals(runtime.activeAbortListenerCount(), 0);
    assertEquals(client.activeAbortListenerCount(), 0);
  });
});

function createAbortListenerCountingController(): AbortController & {
  activeAbortListenerCount(): number;
} {
  const controller = new AbortController() as AbortController & {
    activeAbortListenerCount(): number;
  };
  const { signal } = controller;
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
  controller.activeAbortListenerCount = () => activeAbortListeners;
  return controller;
}

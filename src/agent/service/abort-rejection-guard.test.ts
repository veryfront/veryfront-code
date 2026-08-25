import { assertEquals, assertStrictEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  type AbortRejectionEvent,
  type AbortRejectionEventTarget,
  type AbortRejectionProcessTarget,
  installAbortRejectionGuard,
  isAbortRejectionReason,
} from "./abort-rejection-guard.ts";

function createProcessTarget(): {
  target: AbortRejectionProcessTarget;
  emit(reason: unknown): void;
  listenerCount(): number;
} {
  const listeners: Array<(reason: unknown) => void> = [];
  return {
    target: {
      on(_event, listener) {
        listeners.push(listener);
      },
      off(_event, listener) {
        const index = listeners.indexOf(listener);
        if (index >= 0) listeners.splice(index, 1);
      },
    },
    emit(reason) {
      for (const listener of [...listeners]) listener(reason);
    },
    listenerCount() {
      return listeners.length;
    },
  };
}

function createEventTarget(): {
  target: AbortRejectionEventTarget;
  emit(reason: unknown): boolean;
  listenerCount(): number;
} {
  const listeners: Array<(event: AbortRejectionEvent) => void> = [];
  return {
    target: {
      addEventListener(_event, listener) {
        listeners.push(listener);
      },
      removeEventListener(_event, listener) {
        const index = listeners.indexOf(listener);
        if (index >= 0) listeners.splice(index, 1);
      },
    },
    emit(reason) {
      let prevented = false;
      for (const listener of [...listeners]) {
        listener({
          reason,
          preventDefault() {
            prevented = true;
          },
        });
      }
      return prevented;
    },
    listenerCount() {
      return listeners.length;
    },
  };
}

describe("agent/abort-rejection-guard", () => {
  it("identifies AbortError-shaped rejection reasons", () => {
    assertEquals(isAbortRejectionReason(new DOMException("cancelled", "AbortError")), true);
    assertEquals(isAbortRejectionReason(new Error("not an abort")), false);
    assertEquals(isAbortRejectionReason({ name: "AbortError" }), true);
  });

  it("logs AbortError unhandled rejections and preserves fatal behavior for other errors", async () => {
    const processTarget = createProcessTarget();
    const warnings: Array<{ message: string; metadata?: Record<string, unknown> }> = [];

    const guard = installAbortRejectionGuard({
      processTarget: processTarget.target,
      eventTarget: null,
      loadLogger: () => ({
        warn: (message, metadata) => warnings.push({ message, metadata }),
      }),
      fallbackWarn: (message, metadata) => warnings.push({ message, metadata }),
    });

    const abortError = new DOMException("stream cancelled", "AbortError");
    processTarget.emit(abortError);
    await Promise.resolve();

    assertEquals(warnings.length, 1);
    assertEquals(warnings[0]?.message, "Agent abort rejection swallowed");
    assertEquals(warnings[0]?.metadata?.message, "stream cancelled");

    const failure = new Error("boom");
    assertThrows(() => processTarget.emit(failure), Error, "boom");

    guard.dispose();
    assertEquals(processTarget.listenerCount(), 0);
  });

  it("prevents default browser-style AbortError rejection handling", async () => {
    const eventTarget = createEventTarget();
    const warnings: string[] = [];
    const guard = installAbortRejectionGuard({
      processTarget: null,
      eventTarget: eventTarget.target,
      loadLogger: () => ({
        warn: (message) => warnings.push(message),
      }),
    });

    assertEquals(eventTarget.emit(new Error("boom")), false);
    assertEquals(eventTarget.emit(new DOMException("cancelled", "AbortError")), true);
    await Promise.resolve();

    assertEquals(warnings, ["Agent abort rejection swallowed"]);
    guard.dispose();
    assertEquals(eventTarget.listenerCount(), 0);
  });

  it("falls back when logger loading fails", async () => {
    const processTarget = createProcessTarget();
    const fallbackWarnings: Array<Record<string, unknown> | undefined> = [];
    installAbortRejectionGuard({
      processTarget: processTarget.target,
      eventTarget: null,
      loadLogger: () => {
        throw new Error("logger import failed");
      },
      fallbackWarn: (_message, metadata) => fallbackWarnings.push(metadata),
    });

    processTarget.emit(new DOMException("cancelled", "AbortError"));
    await Promise.resolve();

    assertStrictEquals(fallbackWarnings.length, 1);
    assertEquals(fallbackWarnings[0]?.loggerImportError, "logger import failed");
  });
});

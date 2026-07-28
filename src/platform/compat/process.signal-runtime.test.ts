import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import process from "node:process";
import { onSignal } from "./process.ts";
import { isDeno } from "./runtime.ts";

describe("process signal compatibility", () => {
  it("disposes a Node-compatible listener exactly once", {
    ignore: isDeno,
    sanitizeResources: false,
    sanitizeOps: false,
  }, () => {
    const signal = "SIGTERM";
    const baseline = process.listenerCount(signal);
    const sentinel = () => {};
    const handler = () => {};
    process.on(signal, sentinel);

    try {
      const dispose = onSignal(signal, handler);
      assertEquals(process.listeners(signal).includes(handler), true);

      dispose();
      dispose();

      assertEquals(process.listenerCount(signal), baseline + 1);
      assertEquals(process.listeners(signal).includes(handler), false);
      assertEquals(process.listeners(signal).includes(sentinel), true);
    } finally {
      process.off(signal, handler);
      process.off(signal, sentinel);
    }
  });

  it("rolls back a partial Node-compatible registration and preserves its error", {
    ignore: isDeno,
    sanitizeResources: false,
    sanitizeOps: false,
  }, () => {
    const signal = "SIGTERM";
    const baseline = process.listenerCount(signal);
    const handler = () => {};
    const registrationError = new Error("runtime signal bind failed");
    const ownOnDescriptor = Object.getOwnPropertyDescriptor(process, "on");
    const originalOn = process.on;
    Object.defineProperty(process, "on", {
      configurable: true,
      writable: true,
      value: (event: string | symbol, listener: (...args: unknown[]) => void) => {
        Reflect.apply(originalOn, process, [event, listener]);
        if (event === signal && listener === handler) throw registrationError;
        return process;
      },
    });

    let rejection: unknown;
    let listenerCountAfterFailure = -1;
    let listenerPresentAfterFailure = true;
    try {
      onSignal(signal, handler);
    } catch (error) {
      rejection = error;
    } finally {
      if (ownOnDescriptor) {
        Object.defineProperty(process, "on", ownOnDescriptor);
      } else {
        Reflect.deleteProperty(process, "on");
      }
      listenerCountAfterFailure = process.listenerCount(signal);
      listenerPresentAfterFailure = process.listeners(signal).includes(handler);
      process.off(signal, handler);
    }

    assertStrictEquals(rejection, registrationError);
    assertEquals(listenerCountAfterFailure, baseline);
    assertEquals(listenerPresentAfterFailure, false);
  });

  it("preserves Node registration and rollback failures together", {
    ignore: isDeno,
    sanitizeResources: false,
    sanitizeOps: false,
  }, () => {
    const signal = "SIGTERM";
    const baseline = process.listenerCount(signal);
    const handler = () => {};
    const registrationError = new Error("runtime signal bind failed");
    const cleanupError = new Error("runtime signal rollback failed");
    const ownOnDescriptor = Object.getOwnPropertyDescriptor(process, "on");
    const ownOffDescriptor = Object.getOwnPropertyDescriptor(process, "off");
    const originalOn = process.on;
    Object.defineProperty(process, "on", {
      configurable: true,
      writable: true,
      value: (event: string | symbol, listener: (...args: unknown[]) => void) => {
        Reflect.apply(originalOn, process, [event, listener]);
        if (event === signal && listener === handler) throw registrationError;
        return process;
      },
    });
    Object.defineProperty(process, "off", {
      configurable: true,
      writable: true,
      value: () => {
        throw cleanupError;
      },
    });

    let rejection: unknown;
    let listenerPresentAfterFailure = false;
    try {
      onSignal(signal, handler);
    } catch (error) {
      rejection = error;
    } finally {
      listenerPresentAfterFailure = process.listeners(signal).includes(handler);
      if (ownOnDescriptor) Object.defineProperty(process, "on", ownOnDescriptor);
      else Reflect.deleteProperty(process, "on");
      if (ownOffDescriptor) Object.defineProperty(process, "off", ownOffDescriptor);
      else Reflect.deleteProperty(process, "off");
      process.off(signal, handler);
    }

    assertEquals(rejection instanceof AggregateError, true);
    assertEquals((rejection as AggregateError).errors, [
      registrationError,
      cleanupError,
    ]);
    assertEquals(listenerPresentAfterFailure, true);
    assertEquals(process.listenerCount(signal), baseline);
  });
});

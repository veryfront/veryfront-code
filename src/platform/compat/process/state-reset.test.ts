import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ProcessStateResetRegistry } from "./state-reset.ts";

describe("platform/process state reset registry", () => {
  it("runs a persistent snapshot in registration order", async () => {
    const registry = new ProcessStateResetRegistry();
    const calls: string[] = [];
    registry.register("first", () => {
      calls.push("first");
    });
    registry.register("second", async () => {
      await Promise.resolve();
      calls.push("second");
    });

    assertEquals(await registry.run(), []);
    assertEquals(await registry.run(), []);
    assertEquals(calls, ["first", "second", "first", "second"]);
  });

  it("contains failures and unregisters only the owned registration", async () => {
    const registry = new ProcessStateResetRegistry();
    const calls: string[] = [];
    const unregister = registry.register("failing owner", () => {
      throw new Error("private reset detail");
    });
    registry.register("healthy owner", () => {
      calls.push("healthy");
    });

    const failures = await registry.run();
    assertEquals(failures.length, 1);
    assertEquals(failures[0]?.label, "failing owner");
    assertEquals(calls, ["healthy"]);

    unregister();
    unregister();
    assertEquals(registry.size, 1);
    assertEquals(await registry.run(), []);
    assertEquals(calls, ["healthy", "healthy"]);
  });

  it("replaces a reloaded owner without leaking registrations", async () => {
    const registry = new ProcessStateResetRegistry();
    const calls: string[] = [];
    const unregisterStale = registry.register("reloadable owner", () => {
      calls.push("stale");
    });
    const unregisterCurrent = registry.register("reloadable owner", () => {
      calls.push("current");
    });

    assertEquals(registry.size, 1);
    unregisterStale();
    assertEquals(registry.size, 1);
    assertEquals(await registry.run(), []);
    assertEquals(calls, ["current"]);

    unregisterCurrent();
    assertEquals(registry.size, 0);
  });

  it("rejects malformed registrations before changing state", () => {
    const registry = new ProcessStateResetRegistry();
    assertThrows(() => registry.register("", () => undefined), TypeError);
    assertThrows(() => registry.register("bad\nlabel", () => undefined), TypeError);
    assertThrows(() => registry.register("x".repeat(129), () => undefined), TypeError);
    assertThrows(() => registry.register("valid", undefined as never), TypeError);
    assertEquals(registry.size, 0);
  });

  it("bounds distinct owners while allowing an existing owner to reload", () => {
    const registry = new ProcessStateResetRegistry();
    for (let index = 0; index < 256; index++) {
      registry.register(`owner ${index}`, () => undefined);
    }

    assertThrows(() => registry.register("owner 256", () => undefined), RangeError);
    const unregisterReplacement = registry.register("owner 0", () => undefined);
    assertEquals(registry.size, 256);

    unregisterReplacement();
    assertEquals(registry.size, 255);
  });
});

import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { AsyncLocalStorage } from "./node-async-hooks.ts";
import nodeNoop from "./node-noop.ts";

describe("platform browser Node polyfills", () => {
  it("keeps the unknown-builtin placeholder immutable", () => {
    assertEquals(Object.isFrozen(nodeNoop), true);
    assertThrows(
      () => {
        (nodeNoop as Record<string, unknown>)["unexpected"] = true;
      },
      TypeError,
    );
  });

  it("runs AsyncLocalStorage callbacks without exposing server context", () => {
    const storage = new AsyncLocalStorage<string>();
    storage.enterWith("server-only");

    const result = storage.run(
      "request",
      (left, right) => {
        assertEquals(storage.getStore(), undefined);
        return Number(left) + Number(right);
      },
      2,
      3,
    );

    assertEquals(result, 5);
    storage.disable();
    assertEquals(storage.getStore(), undefined);
  });
});

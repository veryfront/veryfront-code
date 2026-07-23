import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { AsyncLocalStorage } from "./node-async-hooks.ts";

describe("platform/polyfills/node-async-hooks", () => {
  it("runs callbacks and forwards arguments without retaining server context", () => {
    const storage = new AsyncLocalStorage<string>();
    const result = storage.run("request-context", (...args) => args.join(":"), "one", "two");

    assertEquals(result, "one:two");
    assertEquals(storage.getStore(), undefined);
  });

  it("keeps enterWith and disable as safe no-ops", () => {
    const storage = new AsyncLocalStorage<string>();

    storage.enterWith("request-context");
    storage.disable();

    assertEquals(storage.getStore(), undefined);
  });
});

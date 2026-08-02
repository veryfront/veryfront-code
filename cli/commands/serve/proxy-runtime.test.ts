import "#veryfront/schemas/_test-setup.ts";

import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { runStandaloneProxyRuntime } from "./proxy-runtime.ts";

describe("standalone proxy runtime", () => {
  const originalHost = Deno.env.get("HOST");
  const originalPort = Deno.env.get("PORT");

  afterEach(() => {
    if (originalHost === undefined) Deno.env.delete("HOST");
    else Deno.env.set("HOST", originalHost);
    if (originalPort === undefined) Deno.env.delete("PORT");
    else Deno.env.set("PORT", originalPort);
  });

  it("shares CLI bind options with the proxy entrypoint", async () => {
    const observed: string[] = [];

    await runStandaloneProxyRuntime(
      { bindAddress: "127.0.0.2", port: 4321 },
      {
        activateExtensions: async () => null,
        registerTeardown: async () => async () => undefined,
        loadProxy: async () => {
          observed.push(`${Deno.env.get("HOST")}:${Deno.env.get("PORT")}`);
        },
        keepAlive: async () => undefined,
      },
    );

    assertEquals(observed, ["127.0.0.2:4321"]);
  });

  it("tears down activated extensions when proxy startup fails", async () => {
    let teardownCount = 0;

    await assertRejects(
      () =>
        runStandaloneProxyRuntime({}, {
          activateExtensions: async () => null,
          registerTeardown: async () => async () => {
            teardownCount++;
          },
          loadProxy: () => Promise.reject(new Error("proxy startup failed")),
          keepAlive: async () => undefined,
        }),
      Error,
      "proxy startup failed",
    );

    assertEquals(teardownCount, 1);
  });
});

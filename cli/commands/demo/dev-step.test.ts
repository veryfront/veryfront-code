import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { DevCommandResult } from "../dev/index.ts";
import { runDemoDevStep } from "./dev-step.ts";

/** A dev server that fell forward off the requested 3000 onto `port`. */
function devServerOn(port: number): { result: DevCommandResult; stopped: () => boolean } {
  let stopped = false;
  return {
    stopped: () => stopped,
    result: {
      ready: Promise.resolve(),
      done: Promise.resolve(),
      port,
      stop: () => {
        stopped = true;
        return Promise.resolve();
      },
    },
  };
}

describe("cli/commands/demo/dev-step", () => {
  it("shows and opens the port the server bound, not the requested 3000", async () => {
    const server = devServerOn(3007);
    const lines: string[] = [];
    const opened: string[] = [];

    await runDemoDevStep({
      start: () => Promise.resolve(server.result),
      open: (url) => {
        opened.push(url);
        return Promise.resolve();
      },
      waitForStop: () => Promise.resolve(true),
      log: (line) => lines.push(line),
    });

    assertEquals(opened, ["http://localhost:3007"]);

    const shown = lines.find((line) => line.includes("http://localhost:"));
    assert(shown !== undefined, "the demo must print the dev server address");
    assertStringIncludes(shown, "http://localhost:3007/");

    // The requested port belongs to whatever caused the collision.
    assertEquals(lines.some((line) => line.includes(":3000")), false);
  });

  it("uses the requested port when the server kept it", async () => {
    const server = devServerOn(3000);
    const opened: string[] = [];

    await runDemoDevStep({
      start: () => Promise.resolve(server.result),
      open: (url) => {
        opened.push(url);
        return Promise.resolve();
      },
      waitForStop: () => Promise.resolve(true),
      log: () => {},
    });

    assertEquals(opened, ["http://localhost:3000"]);
  });

  it("stops the server once the viewer asks to move on", async () => {
    const server = devServerOn(4123);
    const order: string[] = [];

    await runDemoDevStep({
      start: () => Promise.resolve(server.result),
      open: () => Promise.resolve(),
      waitForStop: () => {
        order.push("waited");
        return Promise.resolve(true);
      },
      log: () => {},
    });

    assertEquals(order, ["waited"]);
    assertEquals(server.stopped(), true);
  });

  it("still stops the server when no browser can be opened", async () => {
    const server = devServerOn(4123);

    await runDemoDevStep({
      start: () => Promise.resolve(server.result),
      open: () => Promise.reject(new Error("no browser here")),
      waitForStop: () => Promise.resolve(true),
      log: () => {},
    });

    assertEquals(server.stopped(), true);
  });
});

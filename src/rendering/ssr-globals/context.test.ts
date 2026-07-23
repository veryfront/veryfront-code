import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getSSRServerPort, isSSRClientOnlyFetching, runWithSSRRequestGlobals } from "./context.ts";

describe("SSR request globals", () => {
  it("isolates concurrent server settings across async request work", async () => {
    let releaseFirst: () => void = () => {};
    const firstCanFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstStarted: () => void = () => {};
    const firstIsRunning = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });

    const first = runWithSSRRequestGlobals(
      { clientOnlyFetching: true, serverPort: 3101 },
      async () => {
        firstStarted();
        await firstCanFinish;
        return [getSSRServerPort(), isSSRClientOnlyFetching()] as const;
      },
    );
    await firstIsRunning;

    const second = runWithSSRRequestGlobals(
      { clientOnlyFetching: false, serverPort: 3102 },
      async () => {
        await Promise.resolve();
        return [getSSRServerPort(), isSSRClientOnlyFetching()] as const;
      },
    );
    releaseFirst();

    assertEquals(await Promise.all([first, second]), [
      [3101, true],
      [3102, false],
    ]);
  });

  it("rejects invalid request-local settings before invoking the callback", () => {
    let called = false;
    assertThrows(
      () =>
        runWithSSRRequestGlobals(
          { clientOnlyFetching: true, serverPort: 65_536 },
          () => {
            called = true;
          },
        ),
      TypeError,
      "between 0 and 65535",
    );
    assertEquals(called, false);
  });

  it("snapshots bounded fields without copying untrusted context properties", () => {
    let portReads = 0;
    let extraReads = 0;
    const globals = {
      clientOnlyFetching: true,
      get serverPort() {
        portReads++;
        return portReads === 1 ? 3101 : 70_000;
      },
      get extra() {
        extraReads++;
        return "private-context-canary";
      },
    };

    const observed = runWithSSRRequestGlobals(
      globals,
      () => [getSSRServerPort(), isSSRClientOnlyFetching()],
    );

    assertEquals(observed, [3101, true]);
    assertEquals(portReads, 1);
    assertEquals(extraReads, 0);
  });
});

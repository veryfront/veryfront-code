import { assertEquals, assertRejects, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { Browser } from "npm:playwright@1.60.0";
import {
  CHROMIUM_LAUNCH_TIMEOUT_MS,
  launchChromiumWith,
  parseBrowserBridgeMessage,
} from "./playwright.ts";

describe("parseBrowserBridgeMessage", () => {
  it("accepts a local Playwright WebSocket endpoint", () => {
    assertEquals(
      parseBrowserBridgeMessage('{"wsEndpoint":"ws://127.0.0.1:1234/browser"}'),
      { wsEndpoint: "ws://127.0.0.1:1234/browser" },
    );
  });

  it("rejects malformed bridge output", async () => {
    await assertRejects(
      () => Promise.resolve().then(() => parseBrowserBridgeMessage("not-json")),
      Error,
      "invalid JSON",
    );
    await assertRejects(
      () => Promise.resolve().then(() => parseBrowserBridgeMessage('{"wsEndpoint":"http://x"}')),
      Error,
      "invalid WebSocket endpoint",
    );
  });
});

describe("launchChromiumWith", () => {
  it("passes an explicit bounded timeout to Playwright", async () => {
    const expectedBrowser = {} as Browser;
    let receivedOptions: { headless: boolean; timeout: number } | undefined;

    const browser = await launchChromiumWith({
      launch(options) {
        receivedOptions = options;
        return Promise.resolve(expectedBrowser);
      },
    });

    assertStrictEquals(browser, expectedBrowser);
    assertEquals(receivedOptions, {
      headless: true,
      timeout: CHROMIUM_LAUNCH_TIMEOUT_MS,
    });
  });

  it("keeps non-installation launch errors as failures", async () => {
    await assertRejects(
      () =>
        launchChromiumWith({
          launch() {
            return Promise.reject(new Error("Chromium launch timed out"));
          },
        }),
      Error,
      "Chromium launch timed out",
    );
  });

  it("keeps a missing executable as a skipped browser session", async () => {
    const browser = await launchChromiumWith({
      launch() {
        return Promise.reject(new Error("Executable doesn't exist"));
      },
    });

    assertEquals(browser, null);
  });
});

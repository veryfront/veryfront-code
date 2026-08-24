import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { getConfig, initConfig } from "./bridge-config.ts";

const originalWindow = globalThis.window;
const originalBridgeConfig = (globalThis as Record<string, unknown>).__VF_BRIDGE_CONFIG__;

function setTestWindow(search = ""): void {
  Object.defineProperty(globalThis, "window", {
    value: { location: { search } },
    configurable: true,
  });
}

function setInjectedConfig(config: Record<string, unknown> | undefined): void {
  Object.defineProperty(globalThis, "__VF_BRIDGE_CONFIG__", {
    value: config,
    writable: true,
    configurable: true,
  });
}

describe("studio/bridge/bridge-config", () => {
  beforeEach(() => {
    setTestWindow();
    setInjectedConfig(undefined);
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "window", {
      value: originalWindow,
      configurable: true,
    });
    Object.defineProperty(globalThis, "__VF_BRIDGE_CONFIG__", {
      value: originalBridgeConfig,
      writable: true,
      configurable: true,
    });
  });

  it("uses safe defaults when the injected bridge config is missing", () => {
    initConfig();

    assertEquals(getConfig(), {
      projectId: "",
      pageId: "",
      pagePath: "",
      wsUrl: "",
      yjsGuid: "",
      studioMode: "advanced",
      debugSkipInit: false,
      debugExposeInternals: false,
    });
  });

  it("lets the query string force simple mode", () => {
    setTestWindow("?vf_studio_mode=simple");
    setInjectedConfig({
      projectId: "project-1",
      pageId: "page-1",
      pagePath: "page-1.mdx",
      studioMode: "advanced",
    });

    initConfig();

    assertEquals(getConfig().studioMode, "simple");
    assertEquals(
      getConfig().pagePath,
      "page-1.mdx",
      "an explicitly injected pagePath wins over pageId",
    );
  });

  it("honors the injected simple mode without a query override", () => {
    setTestWindow("");
    setInjectedConfig({
      projectId: "project-1",
      pageId: "page-1",
      studioMode: "simple",
    });

    initConfig();

    assertEquals(
      getConfig().studioMode,
      "simple",
      "injected studioMode simple must win with an empty query string",
    );
  });

  it("falls back to advanced for an unrecognized injected mode", () => {
    setTestWindow("");
    setInjectedConfig({
      projectId: "project-1",
      pageId: "page-1",
      studioMode: "SIMPLE",
    });

    initConfig();

    assertEquals(
      getConfig().studioMode,
      "advanced",
      "only the exact value simple selects simple mode",
    );
  });

  it("normalizes injected config values and falls back pagePath to pageId", () => {
    setInjectedConfig({
      projectId: 42,
      pageId: 7,
      wsUrl: 123,
      yjsGuid: null,
      debugSkipInit: 1,
      debugExposeInternals: "",
    });

    initConfig();

    assertEquals(getConfig(), {
      projectId: "42",
      pageId: "7",
      pagePath: "7",
      wsUrl: "123",
      yjsGuid: "",
      studioMode: "advanced",
      debugSkipInit: true,
      debugExposeInternals: false,
    });
  });
});

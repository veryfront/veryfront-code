import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { getConfig, initConfig } from "./bridge-config.ts";
import {
  MAX_STUDIO_CONFIG_ID_LENGTH,
  MAX_STUDIO_CONFIG_NONCE_LENGTH,
  MAX_STUDIO_CONFIG_PATH_LENGTH,
} from "../limits.ts";

const originalWindow = globalThis.window;
const originalBridgeConfig = (globalThis as Record<string, unknown>).__VF_BRIDGE_CONFIG__;

function setTestWindow(search = ""): void {
  Object.defineProperty(globalThis, "window", {
    value: { location: { search } },
    configurable: true,
  });
}

function setInjectedConfig(config: unknown): void {
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
      nonce: "",
    });
  });

  it("accepts typed config values and falls back pagePath to pageId", () => {
    setInjectedConfig({
      projectId: "project-42",
      pageId: "page-7",
    });

    initConfig();

    assertEquals(getConfig(), {
      projectId: "project-42",
      pageId: "page-7",
      pagePath: "page-7",
      nonce: "",
    });
  });

  it("accepts a null-prototype data record", () => {
    const injected = Object.assign(Object.create(null), {
      projectId: "project-42",
      pageId: "page-7",
    });
    setInjectedConfig(injected);

    initConfig();

    assertEquals(getConfig().projectId, "project-42");
  });

  it("rejects non-plain and proxied config carriers", () => {
    class ConfigCarrier {
      projectId = "project-42";
    }

    for (
      const injected of [
        null,
        true,
        () => ({ projectId: "project-42" }),
        [],
        new Date(0),
        new ConfigCarrier(),
        new Proxy({ projectId: "project-42" }, {}),
      ]
    ) {
      setInjectedConfig(injected);

      assertThrows(
        () => initConfig(),
        TypeError,
        "plain data record",
      );
    }
  });

  it("rejects coercive primitive config values", () => {
    for (const injected of [{ projectId: 42 }]) {
      setInjectedConfig(injected);

      let error: unknown;
      try {
        initConfig();
      } catch (caught) {
        error = caught;
      }

      assertEquals(error instanceof TypeError, true);
    }
  });

  it("rejects retired bridge features instead of silently ignoring them", () => {
    for (
      const [field, value] of [
        ["wsUrl", "configured"],
        ["yjsGuid", "configured"],
        ["studioMode", "advanced"],
        ["debugSkipInit", true],
        ["debugExposeInternals", true],
      ] as const
    ) {
      setInjectedConfig({ [field]: value });

      let error: unknown;
      try {
        initConfig();
      } catch (caught) {
        error = caught;
      }

      assertEquals(error instanceof TypeError, true);
    }
  });

  it("rejects unknown config properties, including likely field-name typos", () => {
    for (const field of ["projectID", "pageID", "pagePaht", "nonse", "unexpected"]) {
      setInjectedConfig({ projectId: "project-42", [field]: "ignored" });

      assertThrows(
        () => initConfig(),
        TypeError,
        "unsupported",
      );
    }
  });

  it("rejects accessor-backed config without executing the accessor", () => {
    let getterCalls = 0;
    const injected = Object.defineProperty({}, "projectId", {
      enumerable: true,
      get() {
        getterCalls++;
        return "unsafe";
      },
    });
    setInjectedConfig(injected);

    let error: unknown;
    try {
      initConfig();
    } catch (caught) {
      error = caught;
    }

    assertEquals(error instanceof TypeError, true);
    assertEquals(getterCalls, 0);
  });

  it("rejects object coercion without invoking custom conversion", () => {
    let conversionCalls = 0;
    setInjectedConfig({
      projectId: {
        toString() {
          conversionCalls++;
          return "unsafe";
        },
      },
    });

    let error: unknown;
    try {
      initConfig();
    } catch (caught) {
      error = caught;
    }

    assertEquals(error instanceof TypeError, true);
    assertEquals(conversionCalls, 0);
  });

  it("rejects an accessor-backed global config without executing it", () => {
    let getterCalls = 0;
    Object.defineProperty(globalThis, "__VF_BRIDGE_CONFIG__", {
      configurable: true,
      get() {
        getterCalls++;
        return {};
      },
    });

    let error: unknown;
    try {
      initConfig();
    } catch (caught) {
      error = caught;
    }

    assertEquals(error instanceof TypeError, true);
    assertEquals(getterCalls, 0);
  });

  it("rejects unbounded injected strings", () => {
    for (
      const injected of [
        { projectId: "x".repeat(MAX_STUDIO_CONFIG_ID_LENGTH + 1) },
        { nonce: "x".repeat(MAX_STUDIO_CONFIG_NONCE_LENGTH + 1) },
      ]
    ) {
      setInjectedConfig(injected);

      let error: unknown;
      try {
        initConfig();
      } catch (caught) {
        error = caught;
      }

      assertEquals(error instanceof TypeError, true);
    }
  });

  it("accepts every config string at its shared boundary", () => {
    setInjectedConfig({
      projectId: "p".repeat(MAX_STUDIO_CONFIG_ID_LENGTH),
      pageId: "i".repeat(MAX_STUDIO_CONFIG_ID_LENGTH),
      pagePath: "f".repeat(MAX_STUDIO_CONFIG_PATH_LENGTH),
      nonce: "n".repeat(MAX_STUDIO_CONFIG_NONCE_LENGTH),
    });

    initConfig();

    assertEquals(getConfig().projectId.length, MAX_STUDIO_CONFIG_ID_LENGTH);
    assertEquals(getConfig().pagePath.length, MAX_STUDIO_CONFIG_PATH_LENGTH);
    assertEquals(getConfig().nonce.length, MAX_STUDIO_CONFIG_NONCE_LENGTH);
  });

  it("preserves the request CSP nonce for runtime style injection", () => {
    setInjectedConfig({ nonce: "request-nonce" });

    initConfig();

    assertEquals(getConfig().nonce, "request-nonce");
  });
});

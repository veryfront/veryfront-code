import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { NetworkUtils } from "./network-utils.ts";
import type { NetworkInfo } from "./network-utils.ts";

function mockNavigator(navObject: any): () => void {
  const original = globalThis.navigator;
  delete (globalThis as any).navigator;
  (globalThis as any).navigator = navObject;

  return () => {
    delete (globalThis as any).navigator;
    (globalThis as any).navigator = original;
  };
}

function withMockNavigator<T>(navObject: any, fn: () => T): T {
  const restore = mockNavigator(navObject);
  try {
    return fn();
  } finally {
    restore();
  }
}

function connection(effectiveType: NetworkInfo["effectiveType"], saveData = false): NetworkInfo {
  return { effectiveType, saveData };
}

describe("NetworkUtils", () => {
  describe("Constructor", () => {
    it("should create NetworkUtils with default allowed networks", () => {
      withMockNavigator({ connection: null }, () => {
        const networkUtils = new NetworkUtils();
        assertExists(networkUtils);
      });
    });

    it("should create NetworkUtils with custom allowed networks", () => {
      withMockNavigator({ connection: null }, () => {
        const networkUtils = new NetworkUtils(["5g", "wifi"]);
        assertExists(networkUtils);
      });
    });

    it("should detect network connection from navigator.connection", () => {
      const mockConnection: NetworkInfo = connection("4g", false);

      withMockNavigator({ connection: mockConnection }, () => {
        const networkUtils = new NetworkUtils();
        const info = networkUtils.getNetworkInfo();

        assertExists(info);
        assertEquals(info?.effectiveType, "4g");
      });
    });

    it("should detect network connection from navigator.mozConnection", () => {
      const mockConnection: NetworkInfo = connection("wifi", false);

      withMockNavigator({ mozConnection: mockConnection }, () => {
        const networkUtils = new NetworkUtils();
        const info = networkUtils.getNetworkInfo();

        assertExists(info);
        assertEquals(info?.effectiveType, "wifi");
      });
    });

    it("should detect network connection from navigator.webkitConnection", () => {
      const mockConnection: NetworkInfo = connection("ethernet", false);

      withMockNavigator({ webkitConnection: mockConnection }, () => {
        const networkUtils = new NetworkUtils();
        const info = networkUtils.getNetworkInfo();

        assertExists(info);
        assertEquals(info?.effectiveType, "ethernet");
      });
    });

    it("should return null when no network connection is available", () => {
      withMockNavigator({}, () => {
        const networkUtils = new NetworkUtils();
        assertEquals(networkUtils.getNetworkInfo(), null);
      });
    });
  });

  describe("shouldPrefetch", () => {
    it("should return true for 4g connection by default", () => {
      withMockNavigator({ connection: connection("4g", false) }, () => {
        const networkUtils = new NetworkUtils();
        assertEquals(networkUtils.shouldPrefetch(), true);
      });
    });

    it("should return true for wifi connection by default", () => {
      withMockNavigator({ connection: connection("wifi", false) }, () => {
        const networkUtils = new NetworkUtils();
        assertEquals(networkUtils.shouldPrefetch(), true);
      });
    });

    it("should return true for ethernet connection by default", () => {
      withMockNavigator({ connection: connection("ethernet", false) }, () => {
        const networkUtils = new NetworkUtils();
        assertEquals(networkUtils.shouldPrefetch(), true);
      });
    });

    it("should return false for 3g connection by default", () => {
      withMockNavigator({ connection: connection("3g", false) }, () => {
        const networkUtils = new NetworkUtils();
        assertEquals(networkUtils.shouldPrefetch(), false);
      });
    });

    it("should return false for 2g connection by default", () => {
      withMockNavigator({ connection: connection("2g", false) }, () => {
        const networkUtils = new NetworkUtils();
        assertEquals(networkUtils.shouldPrefetch(), false);
      });
    });

    it("should return false for slow-2g connection by default", () => {
      withMockNavigator({ connection: connection("slow-2g", false) }, () => {
        const networkUtils = new NetworkUtils();
        assertEquals(networkUtils.shouldPrefetch(), false);
      });
    });

    it("should return false when saveData is enabled", () => {
      withMockNavigator({ connection: connection("4g", true) }, () => {
        const networkUtils = new NetworkUtils();
        assertEquals(networkUtils.shouldPrefetch(), false);
      });
    });

    it("should return true when no network info is available", () => {
      /**
       * Test scenario:
       * When the Network Information API is not available,
       * we should assume the network is good enough for prefetching.
       * This is a sensible default for browsers that don't support
       * the API.
       */
      withMockNavigator({}, () => {
        const networkUtils = new NetworkUtils();
        assertEquals(networkUtils.shouldPrefetch(), true);
      });
    });

    it("should respect custom allowed networks", () => {
      withMockNavigator({ connection: connection("3g", false) }, () => {
        const networkUtils = new NetworkUtils(["3g", "4g", "5g"]);
        assertEquals(networkUtils.shouldPrefetch(), true);
      });
    });

    it("should return false for network not in custom allowed list", () => {
      withMockNavigator({ connection: connection("4g", false) }, () => {
        const networkUtils = new NetworkUtils(["5g", "wifi"]);
        assertEquals(networkUtils.shouldPrefetch(), false);
      });
    });

    it("should prioritize saveData over effectiveType", () => {
      /**
       * Test scenario:
       * Even if the network is fast (4g), if the user has
       * enabled data saver mode, we should respect their preference
       * and not prefetch.
       */
      withMockNavigator({ connection: connection("4g", true) }, () => {
        const networkUtils = new NetworkUtils(["4g"]);
        assertEquals(networkUtils.shouldPrefetch(), false);
      });
    });
  });

  describe("onNetworkChange", () => {
    it("should register network change listener when available", () => {
      let listenerAdded = false;
      const mockConnection: NetworkInfo = {
        effectiveType: "4g",
        saveData: false,
        addEventListener: (event: string, _handler: () => void) => {
          if (event === "change") listenerAdded = true;
        },
      };

      withMockNavigator({ connection: mockConnection }, () => {
        const networkUtils = new NetworkUtils();
        networkUtils.onNetworkChange(() => {});
        assertEquals(listenerAdded, true);
      });
    });

    it("should not throw when addEventListener is not available", () => {
      withMockNavigator({ connection: connection("4g", false) }, () => {
        const networkUtils = new NetworkUtils();
        networkUtils.onNetworkChange(() => {});
      });
    });

    it("should not throw when network info is not available", () => {
      withMockNavigator({}, () => {
        const networkUtils = new NetworkUtils();
        networkUtils.onNetworkChange(() => {});
      });
    });

    it("should pass correct event type to addEventListener", () => {
      let eventType = "";
      const mockConnection: NetworkInfo = {
        effectiveType: "4g",
        saveData: false,
        addEventListener: (event: string, _handler: () => void) => {
          eventType = event;
        },
      };

      withMockNavigator({ connection: mockConnection }, () => {
        const networkUtils = new NetworkUtils();
        networkUtils.onNetworkChange(() => {});
        assertEquals(eventType, "change");
      });
    });

    it("should pass callback function to addEventListener", () => {
      let receivedCallback: (() => void) | null = null;
      const mockConnection: NetworkInfo = {
        effectiveType: "4g",
        saveData: false,
        addEventListener: (_event: string, handler: () => void) => {
          receivedCallback = handler;
        },
      };

      withMockNavigator({ connection: mockConnection }, () => {
        const networkUtils = new NetworkUtils();
        const callback = () => {};
        networkUtils.onNetworkChange(callback);

        assertEquals(receivedCallback, callback);
      });
    });
  });

  describe("getNetworkInfo", () => {
    it("should return network info when available", () => {
      const mockConnection: NetworkInfo = connection("4g", false);

      withMockNavigator({ connection: mockConnection }, () => {
        const networkUtils = new NetworkUtils();
        assertEquals(networkUtils.getNetworkInfo(), mockConnection);
      });
    });

    it("should return null when network info is not available", () => {
      withMockNavigator({}, () => {
        const networkUtils = new NetworkUtils();
        assertEquals(networkUtils.getNetworkInfo(), null);
      });
    });

    it("should return same network info on multiple calls", () => {
      const mockConnection: NetworkInfo = connection("4g", false);

      withMockNavigator({ connection: mockConnection }, () => {
        const networkUtils = new NetworkUtils();
        const info1 = networkUtils.getNetworkInfo();
        const info2 = networkUtils.getNetworkInfo();

        assertEquals(info1, info2);
      });
    });
  });

  describe("Browser Compatibility", () => {
    it("should handle navigator without any connection properties", () => {
      withMockNavigator({ userAgent: "Mozilla/5.0" }, () => {
        const networkUtils = new NetworkUtils();
        assertEquals(networkUtils.getNetworkInfo(), null);
        assertEquals(networkUtils.shouldPrefetch(), true);
      });
    });

    it("should prefer standard connection over vendor-prefixed", () => {
      const standardConnection: NetworkInfo = connection("4g", false);
      const mozConnection: NetworkInfo = connection("3g", false);

      withMockNavigator({ connection: standardConnection, mozConnection }, () => {
        const networkUtils = new NetworkUtils();
        const info = networkUtils.getNetworkInfo();

        assertEquals(info?.effectiveType, "4g");
      });
    });

    it("should fallback to mozConnection when connection is not available", () => {
      const mozConnection: NetworkInfo = connection("4g", false);

      withMockNavigator({ mozConnection }, () => {
        const networkUtils = new NetworkUtils();
        const info = networkUtils.getNetworkInfo();

        assertEquals(info?.effectiveType, "4g");
      });
    });

    it("should fallback to webkitConnection when others are not available", () => {
      const webkitConnection: NetworkInfo = connection("4g", false);

      withMockNavigator({ webkitConnection }, () => {
        const networkUtils = new NetworkUtils();
        const info = networkUtils.getNetworkInfo();

        assertEquals(info?.effectiveType, "4g");
      });
    });
  });

  describe("Edge Cases", () => {
    it("should handle undefined effectiveType gracefully", () => {
      const mockConnection: NetworkInfo = { saveData: false };

      withMockNavigator({ connection: mockConnection }, () => {
        const networkUtils = new NetworkUtils();
        assertEquals(networkUtils.shouldPrefetch(), true);
      });
    });

    it("should handle null effectiveType gracefully", () => {
      const mockConnection: NetworkInfo = { effectiveType: undefined, saveData: false };

      withMockNavigator({ connection: mockConnection }, () => {
        const networkUtils = new NetworkUtils();
        assertEquals(networkUtils.shouldPrefetch(), true);
      });
    });

    it("should handle empty string effectiveType", () => {
      withMockNavigator({ connection: connection("", false) }, () => {
        const networkUtils = new NetworkUtils();
        assertEquals(networkUtils.shouldPrefetch(), false);
      });
    });

    it("should handle empty allowed networks array", () => {
      withMockNavigator({ connection: connection("4g", false) }, () => {
        const networkUtils = new NetworkUtils([]);
        assertEquals(networkUtils.shouldPrefetch(), false);
      });
    });

    it("should handle case-sensitive network types", () => {
      withMockNavigator({ connection: connection("4G", false) }, () => {
        const networkUtils = new NetworkUtils(["4g"]);
        assertEquals(networkUtils.shouldPrefetch(), false);
      });
    });
  });
});

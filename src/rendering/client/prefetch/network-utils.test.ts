/**
 * Unit Tests for Network Utils
 * Tests network connection detection and prefetch eligibility based on network conditions
 */

import { assertEquals, assertExists } from "jsr:@std/assert@1";
import { describe, it } from "jsr:@std/testing@1/bdd";
import { NetworkInfo, NetworkUtils } from "./network-utils.ts";

// Navigator type extension for network connection
interface NavigatorWithConnection extends Navigator {
  connection?: NetworkInfo;
  mozConnection?: NetworkInfo;
  webkitConnection?: NetworkInfo;
}

// Helper to properly mock navigator (Deno's navigator is non-configurable)
function mockNavigator(navObject: any): () => void {
  const original = globalThis.navigator;
  delete (globalThis as any).navigator;
  (globalThis as any).navigator = navObject;

  return () => {
    delete (globalThis as any).navigator;
    (globalThis as any).navigator = original;
  };
}

describe("NetworkUtils", () => {
  describe("Constructor", () => {
    it("should create NetworkUtils with default allowed networks", () => {
      const restore = mockNavigator({ connection: null });
      const networkUtils = new NetworkUtils();
      assertExists(networkUtils);
      restore();
    });

    it("should create NetworkUtils with custom allowed networks", () => {
      const restore = mockNavigator({ connection: null });
      const networkUtils = new NetworkUtils(["5g", "wifi"]);
      assertExists(networkUtils);
      restore();
    });

    it("should detect network connection from navigator.connection", () => {
      const mockConnection: NetworkInfo = {
        effectiveType: "4g",
        saveData: false,
      };
      const restore = mockNavigator({ connection: mockConnection });

      const networkUtils = new NetworkUtils();
      const info = networkUtils.getNetworkInfo();

      assertExists(info);
      assertEquals(info?.effectiveType, "4g");
      restore();
    });

    it("should detect network connection from navigator.mozConnection", () => {
      const mockConnection: NetworkInfo = {
        effectiveType: "wifi",
        saveData: false,
      };
      const restore = mockNavigator({
        mozConnection: mockConnection,
      });

      const networkUtils = new NetworkUtils();
      const info = networkUtils.getNetworkInfo();

      assertExists(info);
      assertEquals(info?.effectiveType, "wifi");
      restore();
    });

    it("should detect network connection from navigator.webkitConnection", () => {
      const mockConnection: NetworkInfo = {
        effectiveType: "ethernet",
        saveData: false,
      };
      const restore = mockNavigator({
        webkitConnection: mockConnection,
      });

      const networkUtils = new NetworkUtils();
      const info = networkUtils.getNetworkInfo();

      assertExists(info);
      assertEquals(info?.effectiveType, "ethernet");
      restore();
    });

    it("should return null when no network connection is available", () => {
      const restore = mockNavigator({});

      const networkUtils = new NetworkUtils();
      const info = networkUtils.getNetworkInfo();

      assertEquals(info, null);
      restore();
    });
  });

  describe("shouldPrefetch", () => {
    it("should return true for 4g connection by default", () => {
      const mockConnection: NetworkInfo = {
        effectiveType: "4g",
        saveData: false,
      };
      const restore = mockNavigator({
        connection: mockConnection,
      });

      const networkUtils = new NetworkUtils();
      assertEquals(networkUtils.shouldPrefetch(), true);
      restore();
    });

    it("should return true for wifi connection by default", () => {
      const mockConnection: NetworkInfo = {
        effectiveType: "wifi",
        saveData: false,
      };
      const restore = mockNavigator({
        connection: mockConnection,
      });

      const networkUtils = new NetworkUtils();
      assertEquals(networkUtils.shouldPrefetch(), true);
      restore();
    });

    it("should return true for ethernet connection by default", () => {
      const mockConnection: NetworkInfo = {
        effectiveType: "ethernet",
        saveData: false,
      };
      const restore = mockNavigator({
        connection: mockConnection,
      });

      const networkUtils = new NetworkUtils();
      assertEquals(networkUtils.shouldPrefetch(), true);
      restore();
    });

    it("should return false for 3g connection by default", () => {
      const mockConnection: NetworkInfo = {
        effectiveType: "3g",
        saveData: false,
      };
      const restore = mockNavigator({
        connection: mockConnection,
      });

      const networkUtils = new NetworkUtils();
      assertEquals(networkUtils.shouldPrefetch(), false);
      restore();
    });

    it("should return false for 2g connection by default", () => {
      const mockConnection: NetworkInfo = {
        effectiveType: "2g",
        saveData: false,
      };
      const restore = mockNavigator({
        connection: mockConnection,
      });

      const networkUtils = new NetworkUtils();
      assertEquals(networkUtils.shouldPrefetch(), false);
      restore();
    });

    it("should return false for slow-2g connection by default", () => {
      const mockConnection: NetworkInfo = {
        effectiveType: "slow-2g",
        saveData: false,
      };
      const restore = mockNavigator({
        connection: mockConnection,
      });

      const networkUtils = new NetworkUtils();
      assertEquals(networkUtils.shouldPrefetch(), false);
      restore();
    });

    it("should return false when saveData is enabled", () => {
      const mockConnection: NetworkInfo = {
        effectiveType: "4g",
        saveData: true,
      };
      const restore = mockNavigator({
        connection: mockConnection,
      });

      const networkUtils = new NetworkUtils();
      assertEquals(networkUtils.shouldPrefetch(), false);
      restore();
    });

    it("should return true when no network info is available", () => {
      /**
       * Test scenario:
       * When the Network Information API is not available,
       * we should assume the network is good enough for prefetching.
       * This is a sensible default for browsers that don't support
       * the API.
       */
      const restore = mockNavigator({});

      const networkUtils = new NetworkUtils();
      assertEquals(networkUtils.shouldPrefetch(), true);
      restore();
    });

    it("should respect custom allowed networks", () => {
      const mockConnection: NetworkInfo = {
        effectiveType: "3g",
        saveData: false,
      };
      const restore = mockNavigator({
        connection: mockConnection,
      });

      const networkUtils = new NetworkUtils(["3g", "4g", "5g"]);
      assertEquals(networkUtils.shouldPrefetch(), true);
      restore();
    });

    it("should return false for network not in custom allowed list", () => {
      const mockConnection: NetworkInfo = {
        effectiveType: "4g",
        saveData: false,
      };
      const restore = mockNavigator({
        connection: mockConnection,
      });

      const networkUtils = new NetworkUtils(["5g", "wifi"]);
      assertEquals(networkUtils.shouldPrefetch(), false);
      restore();
    });

    it("should prioritize saveData over effectiveType", () => {
      /**
       * Test scenario:
       * Even if the network is fast (4g), if the user has
       * enabled data saver mode, we should respect their preference
       * and not prefetch.
       */
      const mockConnection: NetworkInfo = {
        effectiveType: "4g",
        saveData: true,
      };
      const restore = mockNavigator({
        connection: mockConnection,
      });

      const networkUtils = new NetworkUtils(["4g"]);
      assertEquals(networkUtils.shouldPrefetch(), false);
      restore();
    });
  });

  describe("onNetworkChange", () => {
    it("should register network change listener when available", () => {
      let listenerAdded = false;
      const mockConnection: NetworkInfo = {
        effectiveType: "4g",
        saveData: false,
        addEventListener: (event: string, _handler: () => void) => {
          if (event === "change") {
            listenerAdded = true;
          }
        },
      };
      const restore = mockNavigator({
        connection: mockConnection,
      });

      const networkUtils = new NetworkUtils();
      networkUtils.onNetworkChange(() => {});

      assertEquals(listenerAdded, true);
      restore();
    });

    it("should not throw when addEventListener is not available", () => {
      const mockConnection: NetworkInfo = {
        effectiveType: "4g",
        saveData: false,
      };
      const restore = mockNavigator({
        connection: mockConnection,
      });

      const networkUtils = new NetworkUtils();

      // Should not throw
      networkUtils.onNetworkChange(() => {});
      restore();
    });

    it("should not throw when network info is not available", () => {
      const restore = mockNavigator({});

      const networkUtils = new NetworkUtils();

      // Should not throw
      networkUtils.onNetworkChange(() => {});
      restore();
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
      const restore = mockNavigator({
        connection: mockConnection,
      });

      const networkUtils = new NetworkUtils();
      networkUtils.onNetworkChange(() => {});

      assertEquals(eventType, "change");
      restore();
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
      const restore = mockNavigator({
        connection: mockConnection,
      });

      const networkUtils = new NetworkUtils();
      const callback = () => {};
      networkUtils.onNetworkChange(callback);

      assertEquals(receivedCallback, callback);
      restore();
    });
  });

  describe("getNetworkInfo", () => {
    it("should return network info when available", () => {
      const mockConnection: NetworkInfo = {
        effectiveType: "4g",
        saveData: false,
      };
      const restore = mockNavigator({
        connection: mockConnection,
      });

      const networkUtils = new NetworkUtils();
      const info = networkUtils.getNetworkInfo();

      assertEquals(info, mockConnection);
      restore();
    });

    it("should return null when network info is not available", () => {
      const restore = mockNavigator({});

      const networkUtils = new NetworkUtils();
      const info = networkUtils.getNetworkInfo();

      assertEquals(info, null);
      restore();
    });

    it("should return same network info on multiple calls", () => {
      const mockConnection: NetworkInfo = {
        effectiveType: "4g",
        saveData: false,
      };
      const restore = mockNavigator({
        connection: mockConnection,
      });

      const networkUtils = new NetworkUtils();
      const info1 = networkUtils.getNetworkInfo();
      const info2 = networkUtils.getNetworkInfo();

      assertEquals(info1, info2);
      restore();
    });
  });

  describe("Browser Compatibility", () => {
    it("should handle navigator without any connection properties", () => {
      const restore = mockNavigator({
        userAgent: "Mozilla/5.0",
      });

      const networkUtils = new NetworkUtils();
      assertEquals(networkUtils.getNetworkInfo(), null);
      assertEquals(networkUtils.shouldPrefetch(), true);
      restore();
    });

    it("should prefer standard connection over vendor-prefixed", () => {
      const standardConnection: NetworkInfo = {
        effectiveType: "4g",
        saveData: false,
      };

      const mozConnection: NetworkInfo = {
        effectiveType: "3g",
        saveData: false,
      };
      const restore = mockNavigator({
        connection: standardConnection,
        mozConnection: mozConnection,
      });

      const networkUtils = new NetworkUtils();
      const info = networkUtils.getNetworkInfo();

      assertEquals(info?.effectiveType, "4g");
      restore();
    });

    it("should fallback to mozConnection when connection is not available", () => {
      const mozConnection: NetworkInfo = {
        effectiveType: "4g",
        saveData: false,
      };
      const restore = mockNavigator({
        mozConnection: mozConnection,
      });

      const networkUtils = new NetworkUtils();
      const info = networkUtils.getNetworkInfo();

      assertEquals(info?.effectiveType, "4g");
      restore();
    });

    it("should fallback to webkitConnection when others are not available", () => {
      const webkitConnection: NetworkInfo = {
        effectiveType: "4g",
        saveData: false,
      };
      const restore = mockNavigator({
        webkitConnection: webkitConnection,
      });

      const networkUtils = new NetworkUtils();
      const info = networkUtils.getNetworkInfo();

      assertEquals(info?.effectiveType, "4g");
      restore();
    });
  });

  describe("Edge Cases", () => {
    it("should handle undefined effectiveType gracefully", () => {
      const mockConnection: NetworkInfo = {
        saveData: false,
      };
      const restore = mockNavigator({
        connection: mockConnection,
      });

      const networkUtils = new NetworkUtils();
      assertEquals(networkUtils.shouldPrefetch(), true);
      restore();
    });

    it("should handle null effectiveType gracefully", () => {
      const mockConnection: NetworkInfo = {
        effectiveType: undefined,
        saveData: false,
      };
      const restore = mockNavigator({
        connection: mockConnection,
      });

      const networkUtils = new NetworkUtils();
      assertEquals(networkUtils.shouldPrefetch(), true);
      restore();
    });

    it("should handle empty string effectiveType", () => {
      const mockConnection: NetworkInfo = {
        effectiveType: "",
        saveData: false,
      };
      const restore = mockNavigator({
        connection: mockConnection,
      });

      const networkUtils = new NetworkUtils();
      assertEquals(networkUtils.shouldPrefetch(), false);
      restore();
    });

    it("should handle empty allowed networks array", () => {
      const mockConnection: NetworkInfo = {
        effectiveType: "4g",
        saveData: false,
      };
      const restore = mockNavigator({
        connection: mockConnection,
      });

      const networkUtils = new NetworkUtils([]);
      assertEquals(networkUtils.shouldPrefetch(), false);
      restore();
    });

    it("should handle case-sensitive network types", () => {
      const mockConnection: NetworkInfo = {
        effectiveType: "4G", // uppercase
        saveData: false,
      };
      const restore = mockNavigator({
        connection: mockConnection,
      });

      const networkUtils = new NetworkUtils(["4g"]);
      assertEquals(networkUtils.shouldPrefetch(), false);
      restore();
    });
  });
});

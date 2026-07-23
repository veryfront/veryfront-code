import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  getWebSocketProjectSlugOverride,
  HTTP_GATEWAY_TIMEOUT,
  isInternalHost,
  isLightweightPath,
  isMonitoringPath,
  isWebSocketPath,
  LIGHTWEIGHT_PATH_PREFIXES,
  MONITORING_PATHS,
  shouldSkipEnrichedContext,
  TIMEOUT_SENTINEL,
} from "./request-utils.ts";
import { getProdHydrationModulePath } from "#veryfront/html/hydration-script-builder/prod-scripts.ts";

describe("request-utils", () => {
  describe("constants", () => {
    it("has correct HTTP_GATEWAY_TIMEOUT", () => {
      assertEquals(HTTP_GATEWAY_TIMEOUT, 504);
    });

    it("TIMEOUT_SENTINEL is a unique symbol", () => {
      assertEquals(typeof TIMEOUT_SENTINEL, "symbol");
    });

    it("MONITORING_PATHS includes health endpoints", () => {
      assertEquals(MONITORING_PATHS.has("/healthz"), true);
      assertEquals(MONITORING_PATHS.has("/readyz"), true);
      assertEquals(MONITORING_PATHS.has("/_health"), true);
      assertEquals(MONITORING_PATHS.has("/_metrics"), false);
    });

    it("LIGHTWEIGHT_PATH_PREFIXES includes module paths", () => {
      assertEquals(LIGHTWEIGHT_PATH_PREFIXES.includes("/_vf_modules/"), true);
      assertEquals(LIGHTWEIGHT_PATH_PREFIXES.includes("/_vf_styles/"), true);
      assertEquals(LIGHTWEIGHT_PATH_PREFIXES.includes("/_veryfront/modules/"), true);
      assertEquals(LIGHTWEIGHT_PATH_PREFIXES.includes("/_veryfront/hydration-runtime"), true);
    });
  });

  describe("isInternalHost", () => {
    it("returns true for localhost", () => {
      assertEquals(isInternalHost("localhost"), true);
      assertEquals(isInternalHost("localhost:3000"), true);
    });

    it("returns true for loopback addresses", () => {
      assertEquals(isInternalHost("127.0.0.1"), true);
      assertEquals(isInternalHost("127.0.0.2"), true);
      assertEquals(isInternalHost("127.0.0.1:8080"), true);
      assertEquals(isInternalHost("::1"), true);
      assertEquals(isInternalHost("[::1]:8080"), true);
    });

    it("returns true for link-local and private IPv6 addresses", () => {
      assertEquals(isInternalHost("169.254.10.20"), true);
      assertEquals(isInternalHost("[fe80::1]:8080"), true);
      assertEquals(isInternalHost("fd00::1"), true);
    });

    it("normalizes case and a trailing DNS root label", () => {
      assertEquals(isInternalHost("LOCALHOST"), true);
      assertEquals(isInternalHost("localhost."), true);
    });

    it("returns true for private 10.x.x.x addresses", () => {
      assertEquals(isInternalHost("10.0.0.1"), true);
      assertEquals(isInternalHost("10.255.255.255"), true);
    });

    it("returns true for private 172.16-31.x.x addresses", () => {
      assertEquals(isInternalHost("172.16.0.1"), true);
      assertEquals(isInternalHost("172.31.255.255"), true);
      // Out of range
      assertEquals(isInternalHost("172.15.0.1"), false);
      assertEquals(isInternalHost("172.32.0.1"), false);
    });

    it("returns true for private 192.168.x.x addresses", () => {
      assertEquals(isInternalHost("192.168.0.1"), true);
      assertEquals(isInternalHost("192.168.255.255"), true);
    });

    it("returns false for public IP addresses", () => {
      assertEquals(isInternalHost("8.8.8.8"), false);
      assertEquals(isInternalHost("1.1.1.1"), false);
    });

    it("returns false for domain names", () => {
      assertEquals(isInternalHost("example.com"), false);
      assertEquals(isInternalHost("api.veryfront.com"), false);
    });
  });

  describe("isMonitoringPath", () => {
    it("returns true for monitoring paths", () => {
      assertEquals(isMonitoringPath("/healthz"), true);
      assertEquals(isMonitoringPath("/readyz"), true);
      assertEquals(isMonitoringPath("/_health"), true);
      assertEquals(isMonitoringPath("/_metrics"), false);
    });

    it("returns false for non-monitoring paths", () => {
      assertEquals(isMonitoringPath("/"), false);
      assertEquals(isMonitoringPath("/api/users"), false);
      assertEquals(isMonitoringPath("/health"), false); // Missing z
    });
  });

  describe("isLightweightPath", () => {
    it("returns true for module paths", () => {
      assertEquals(isLightweightPath("/_vf_modules/react.js"), true);
      assertEquals(isLightweightPath("/_veryfront/modules/client.js"), true);
      assertEquals(isLightweightPath("/_veryfront/hydration-runtime.js"), true);
      assertEquals(isLightweightPath(getProdHydrationModulePath()), true);
      assertEquals(isLightweightPath("/_veryfront/preview-hmr.js"), true);
      assertEquals(isLightweightPath("/_veryfront/studio-bridge.js"), true);
    });

    it("returns true for CSS paths", () => {
      assertEquals(isLightweightPath("/_vf/css/styles.css"), true);
      assertEquals(isLightweightPath("/_vf_styles/styles.css"), true);
    });

    it("returns true for lib module paths", () => {
      assertEquals(isLightweightPath("/_lib_modules/lodash.js"), true);
    });

    it("returns false for page paths", () => {
      assertEquals(isLightweightPath("/"), false);
      assertEquals(isLightweightPath("/about"), false);
      assertEquals(isLightweightPath("/api/users"), false);
    });
  });

  describe("isWebSocketPath", () => {
    it("returns true for /_ws", () => {
      assertEquals(isWebSocketPath("/_ws"), true);
    });

    it("returns false for other paths", () => {
      assertEquals(isWebSocketPath("/"), false);
      assertEquals(isWebSocketPath("/_ws/sub"), false);
      assertEquals(isWebSocketPath("/_wss"), false);
    });
  });

  describe("getWebSocketProjectSlugOverride", () => {
    it("retains the canonical project override for local development", () => {
      assertEquals(
        getWebSocketProjectSlugOverride(
          new URL("http://localhost/_ws?x-project-slug=test-project"),
          { effectiveHost: "localhost:3000", proxyTrusted: false },
        ),
        "test-project",
      );
    });

    it("requires verified proxy trust for remote project overrides", () => {
      assertEquals(
        getWebSocketProjectSlugOverride(
          new URL("https://example.com/_ws?x-project-slug=other-project"),
          { effectiveHost: "example.com", proxyTrusted: false },
        ),
        undefined,
      );
      assertEquals(
        getWebSocketProjectSlugOverride(
          new URL("https://example.com/_ws?x-project-slug=other-project"),
          { effectiveHost: "example.com", proxyTrusted: true },
        ),
        "other-project",
      );
    });

    it("rejects malformed overrides even on a local host", () => {
      assertEquals(
        getWebSocketProjectSlugOverride(
          new URL("http://localhost/_ws?x-project-slug=..%2Fother-project"),
          { effectiveHost: "localhost", proxyTrusted: false },
        ),
        undefined,
      );
    });

    it("ignores the override outside the WebSocket endpoint", () => {
      assertEquals(
        getWebSocketProjectSlugOverride(
          new URL("http://localhost/page?x-project-slug=test-project"),
          { effectiveHost: "localhost", proxyTrusted: false },
        ),
        undefined,
      );
    });

    it("treats an empty WebSocket override as absent", () => {
      assertEquals(
        getWebSocketProjectSlugOverride(
          new URL("http://localhost/_ws?x-project-slug="),
          { effectiveHost: "localhost", proxyTrusted: false },
        ),
        undefined,
      );
    });
  });

  describe("shouldSkipEnrichedContext", () => {
    it("returns true for the HMR WebSocket endpoint", () => {
      assertEquals(shouldSkipEnrichedContext("/_ws"), true);
    });

    it("returns true for API routes", () => {
      assertEquals(shouldSkipEnrichedContext("/api/users"), true);
      assertEquals(shouldSkipEnrichedContext("/api/bench/status"), true);
    });

    it("returns true for control-plane agent discovery routes", () => {
      assertEquals(shouldSkipEnrichedContext("/api/control-plane/agents/list"), true);
    });

    it("returns true for control-plane run routes", () => {
      assertEquals(shouldSkipEnrichedContext("/api/control-plane/agents/list"), true);
      assertEquals(shouldSkipEnrichedContext("/api/control-plane/runs/run_1"), true);
    });

    it("returns false for render routes", () => {
      assertEquals(shouldSkipEnrichedContext("/"), false);
      assertEquals(shouldSkipEnrichedContext("/bench/interactive"), false);
    });
  });
});
